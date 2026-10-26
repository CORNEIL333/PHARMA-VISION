import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeTx } from '../src/db/index.js';
import { verifyLedger } from '../src/domain/verify.js';
import { computeHash } from '../src/domain/ledger.js';
import { jcs } from '../src/domain/jcs.js';
import { keyMap, makeNode, type TestNode } from './helpers.js';

let n: TestNode;
beforeEach(() => (n = makeNode({ checkpointEvery: 10 })));
afterEach(() => n.cleanup());

const verify = () => verifyLedger(n.db, n.keys.identity.node_id, keyMap(n));

describe('J-01 inscription des événements', () => {
  it('J-01 seq sans trou, prev_hash chaîné, premier prev_hash à 64 zéros', () => {
    writeTx(n.db, () => {
      n.ledger.append('system.initialized', null, { node_id: n.keys.identity.node_id, schema: 1 });
      n.ledger.append('system.settings_changed', 'u1', { key: 'a', old: null, new: 'b' });
    });
    const rows = n.db.prepare('SELECT seq, prev_hash, hash FROM events ORDER BY seq').all() as {
      seq: number;
      prev_hash: string;
      hash: string;
    }[];
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[0]?.prev_hash).toBe('0'.repeat(64));
    expect(rows[1]?.prev_hash).toBe(rows[0]?.hash);
  });

  it('J-01 refuse d’écrire un événement hors transaction', () => {
    expect(() => n.ledger.append('system.initialized', null, {})).toThrow(/transaction/);
  });

  it('J-01 atomicité : si la modification métier échoue, aucun événement n’est écrit', () => {
    expect(() =>
      writeTx(n.db, () => {
        n.ledger.append('system.settings_changed', 'u1', { key: 'x', old: null, new: 'y' });
        n.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('x', 'y');
        n.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('x', 'z'); // violation de clé
      }),
    ).toThrow();
    expect((n.db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c).toBe(0);
    expect((n.db.prepare('SELECT COUNT(*) AS c FROM settings').get() as { c: number }).c).toBe(0);
  });

  it('J-01 les déclencheurs refusent UPDATE et DELETE sur events et checkpoints', () => {
    writeTx(n.db, () => {
      n.ledger.append('system.initialized', null, { schema: 1 });
      n.ledger.checkpoint();
    });
    expect(() => n.db.prepare("UPDATE events SET payload = '{}'").run()).toThrow(/ajout seul/);
    expect(() => n.db.prepare('DELETE FROM events').run()).toThrow(/ajout seul/);
    expect(() => n.db.prepare("UPDATE checkpoints SET signature = 'x'").run()).toThrow(/ajout seul/);
    // Seule colonne modifiable : synced_at (file d'envoi, J-05)
    expect(() =>
      n.db.prepare("UPDATE events SET synced_at = '2026-10-27T09:00:00.000Z'").run(),
    ).not.toThrow();
  });
});

describe('J-03 points de contrôle', () => {
  it('J-03 un point de contrôle signé tous les N événements', () => {
    writeTx(n.db, () => {
      for (let i = 0; i < 25; i++)
        n.ledger.append('system.settings_changed', null, { key: `k${i}`, old: null, new: 'v' });
    });
    const seqs = (n.db.prepare('SELECT seq FROM checkpoints ORDER BY seq').all() as { seq: number }[]).map(
      (r) => r.seq,
    );
    expect(seqs).toEqual([10, 20]);
    expect(verify()).toMatchObject({ ok: true, events: 25, checkpoints: 2 });
  });

  it('J-03 point de contrôle à la demande (clôture, minuit), sans doublon', () => {
    writeTx(n.db, () => n.ledger.append('system.initialized', null, { schema: 1 }));
    const a = writeTx(n.db, () => n.ledger.checkpoint());
    const b = writeTx(n.db, () => n.ledger.checkpoint());
    expect(a?.seq).toBe(1);
    expect(b).toEqual(a);
  });
});

describe('J-04 vérification du journal', () => {
  function fill(k: number) {
    writeTx(n.db, () => {
      for (let i = 0; i < k; i++)
        n.ledger.append('system.settings_changed', null, { key: `k${i}`, old: null, new: 'v' });
    });
  }
  /** Contourne les déclencheurs comme le ferait un attaquant avec un accès direct au fichier. */
  function tamper(sql: string) {
    n.db.exec('DROP TRIGGER events_no_update; DROP TRIGGER events_no_delete;');
    n.db.exec(sql);
  }

  it('J-04 base intacte : ok', () => {
    fill(30);
    expect(verify()).toMatchObject({ ok: true, events: 30 });
  });

  it('J-04 un octet modifié dans payload est détecté avec son seq', () => {
    fill(30);
    tamper(`UPDATE events SET payload = replace(payload, '"k6"', '"k7"') WHERE seq = 7`);
    expect(verify()).toMatchObject({ ok: false, seq: 7, defect: 'hash_mismatch' });
  });

  it('J-04 un événement supprimé est détecté (trou)', () => {
    fill(30);
    tamper('DELETE FROM events WHERE seq = 12');
    expect(verify()).toMatchObject({ ok: false, seq: 12, defect: 'gap' });
  });

  it('J-04 une chaîne entièrement réécrite (empreintes recalculées) est détectée par la signature', () => {
    fill(30);
    n.db.exec('DROP TRIGGER events_no_update;');
    const rows = n.db.prepare('SELECT * FROM events ORDER BY seq').all() as {
      seq: number;
      id: string;
      type: string;
      at: string;
      actor: string | null;
      payload: string;
      prev_hash: string;
    }[];
    let prev = '0'.repeat(64);
    const upd = n.db.prepare('UPDATE events SET payload = ?, prev_hash = ?, hash = ? WHERE seq = ?');
    for (const r of rows) {
      const payload = JSON.parse(r.payload) as Record<string, string>;
      if (r.seq === 5) payload.new = 'falsifié';
      const hash = computeHash({
        seq: r.seq,
        id: r.id,
        type: r.type,
        at: r.at,
        actor: r.actor,
        payload,
        prev_hash: prev,
      });
      upd.run(jcs(payload), prev, hash, r.seq);
      prev = hash;
    }
    // La chaîne est cohérente, mais le point de contrôle signé du seq 10 ne correspond plus.
    expect(verify()).toMatchObject({ ok: false, seq: 10, defect: 'hash_mismatch' });
  });

  it('J-04 projection de stock incohérente avec le journal détectée', () => {
    writeTx(n.db, () => {
      const now = n.clock.now().toISOString();
      n.db
        .prepare(
          `INSERT INTO users (id, username, display_name, role, pw_hash, created_at) VALUES ('u1','t','T','titulaire','x',?)`,
        )
        .run(now);
      n.db
        .prepare(`INSERT INTO products (id, name, created_at, updated_at) VALUES ('p1','P',?,?)`)
        .run(now, now);
      n.db
        .prepare(
          `INSERT INTO lots (id, product_id, lot_number, expiry, created_at) VALUES ('l1','p1','A','2028-01-31',?)`,
        )
        .run(now);
      const ev = n.ledger.append('reception.recorded', 'u1', {
        movements: [{ lot_id: 'l1', qty: 10, kind: 'reception' }],
      });
      n.db
        .prepare(
          `INSERT INTO stock_movements (id, product_id, lot_id, qty, kind, user_id, event_seq, at) VALUES ('m1','p1','l1',10,'reception','u1',?,?)`,
        )
        .run(ev.seq, now);
    });
    expect(verify()).toMatchObject({ ok: true });
    n.db.exec('DROP TRIGGER mov_no_update;');
    n.db.exec(`UPDATE stock_movements SET qty = 12 WHERE id = 'm1'`);
    expect(verify()).toMatchObject({ ok: false, defect: 'projection_mismatch' });
  });

  it('J-04 clé de signature inconnue détectée', () => {
    fill(10);
    expect(verifyLedger(n.db, n.keys.identity.node_id, new Map())).toMatchObject({
      ok: false,
      defect: 'unknown_key',
    });
  });
});
