import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { grant, MATRIX, ROLES, type Action } from '../src/security/rbac.js';
import { totpAt } from '../src/security/totp.js';
import { createAndLogin, makeApp, setupTitulaire, type TestApp } from './helpers.js';

/**
 * U-03 : la matrice du code est comparée CELLULE PAR CELLULE au tableau de la spécification (docs/05 §6).
 * Si quelqu'un modifie l'une sans l'autre, ce test échoue.
 */
const SPEC_ROW_TO_ACTIONS: Record<string, Action[]> = {
  'Vendre, encaisser, ouvrir et fermer sa caisse': ['sale.sell'],
  'Valider une ordonnance': ['prescription.validate'],
  "Voir une image d'ordonnance": ['prescription.view_image'],
  'Annuler une vente': ['sale.void'],
  'Appliquer une remise': ['sale.discount'],
  'Voir les coûts et les marges': ['cost.view'],
  Réceptionner: ['stock.receive'],
  'Créer ou envoyer un bon de commande': ['order.manage'],
  'Ajuster ou détruire du stock': ['stock.adjust'],
  'Faire un inventaire (saisie)': ['inventory.count'],
  'Valider un inventaire': ['inventory.validate'],
  'Créer un rappel': ['recall.create'],
  'Modifier un prix de vente': ['price.edit'],
  'Associer un code-barres, créer une fiche locale': ['catalog.link'],
  'Saisir une demande non satisfaite': ['demand.record'],
  'Voir les rapports de ventes et de stock': ['report.sales', 'report.stock'],
  'Voir la clôture de sa propre caisse': ['cash.own_close_report'],
  'Gérer les comptes': ['user.manage'],
  "Paramètres de l'officine": ['settings.edit'],
  Sauvegarder: ['backup.create'],
  'Restaurer, exporter le journal': ['backup.restore', 'ledger.export'],
  'Vérifier le journal': ['ledger.verify'],
};

function specMatrix(): Map<string, string[]> {
  const md = readFileSync(
    path.resolve(import.meta.dirname, '../../../../docs/05-mvp-officine-spec.md'),
    'utf8',
  );
  const section = md.slice(md.indexOf('## 6. Matrice des droits'), md.indexOf('## 7. API HTTP'));
  const rows = new Map<string, string[]>();
  for (const line of section.split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 5 || cells[0] === 'Action' || cells[0]?.startsWith('---')) continue;
    rows.set(cells[0]!, cells.slice(1));
  }
  return rows;
}

describe('U-03 matrice des droits = spécification §6', () => {
  const spec = specMatrix();
  it('U-03 toutes les lignes de la spécification sont couvertes', () => {
    expect([...spec.keys()].sort()).toEqual(Object.keys(SPEC_ROW_TO_ACTIONS).sort());
  });
  for (const [row, actions] of Object.entries(SPEC_ROW_TO_ACTIONS)) {
    for (const action of actions) {
      ROLES.forEach((role, i) => {
        it(`U-03 ${row} × ${role}`, () => {
          let expected = spec.get(row)![i]!;
          if (expected === '—') expected = '-';
          if (expected === 'lecture stock') expected = action === 'report.stock' ? 'O' : '-';
          expect(grant(role, action)).toBe(expected);
        });
      });
    }
  }
  it('U-03 aucune action du code n’est hors spécification, sauf les actions de postes documentées en annexe D', () => {
    const covered = new Set(Object.values(SPEC_ROW_TO_ACTIONS).flat());
    const extra = (Object.keys(MATRIX) as Action[]).filter((a) => !covered.has(a));
    expect(extra.sort()).toEqual(['device.manage', 'device.pairing_code']);
  });
});

let t: TestApp;
describe('U-03 application des droits côté serveur', () => {
  beforeEach(async () => (t = await makeApp()));
  afterEach(() => t.cleanup());

  it('U-03 un caissier, un préparateur et un pharmacien ne peuvent pas gérer les comptes ; seul le titulaire vérifie et gère', async () => {
    const tit = await setupTitulaire(t);
    for (const role of ['caissier', 'preparateur', 'pharmacien']) {
      const a = await createAndLogin(t, tit, `u${role}`, role);
      const r = await t.app.inject({ url: '/api/v1/users', headers: { cookie: a.cookie } });
      expect(r.json(), role).toMatchObject({ code: 'forbidden' });
      const v = await t.app.inject({
        method: 'POST',
        url: '/api/v1/system/verify-ledger',
        headers: { cookie: a.cookie, 'x-csrf-token': a.csrf },
      });
      expect(v.statusCode, role).toBe(role === 'pharmacien' ? 200 : 403);
    }
  });

  it('U-03 un rôle envoyé par le client est ignoré', async () => {
    const tit = await setupTitulaire(t);
    const a = await createAndLogin(t, tit, 'carine', 'caissier');
    const r = await t.app.inject({
      url: '/api/v1/users',
      headers: { cookie: a.cookie, 'x-role': 'titulaire' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('Spec §5.2 un nouveau titulaire doit activer TOTP avant toute autre action', async () => {
    const tit = await setupTitulaire(t);
    const b = await createAndLogin(t, tit, 'second', 'titulaire');
    const me = (await t.app.inject({ url: '/api/v1/auth/me', headers: { cookie: b.cookie } })).json() as {
      restriction: string;
    };
    expect(me.restriction).toBe('totp_enrollment');
    const blocked = await t.app.inject({
      method: 'POST',
      url: '/api/v1/system/verify-ledger',
      headers: { cookie: b.cookie, 'x-csrf-token': b.csrf },
    });
    expect(blocked.json()).toMatchObject({ code: 'totp_enrollment_required' });
    const H = { cookie: b.cookie, 'x-csrf-token': b.csrf };
    const en = (
      await t.app.inject({ method: 'POST', url: '/api/v1/auth/totp/enroll', headers: H })
    ).json() as { secret: string; otpauth_uri: string };
    expect(en.otpauth_uri).toContain('otpauth://totp/');
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/confirm',
      headers: H,
      payload: { code: totpAt(en.secret, t.clock.now()) },
    });
    expect(ok.statusCode).toBe(200);
    const v = await t.app.inject({ method: 'POST', url: '/api/v1/system/verify-ledger', headers: H });
    expect(v.json()).toMatchObject({ ok: true });
    // Le secret TOTP est chiffré en base (jamais en clair).
    const row = t.db.prepare("SELECT totp_secret_enc FROM users WHERE username = 'second'").get() as {
      totp_secret_enc: string;
    };
    expect(row.totp_secret_enc.startsWith('v1.')).toBe(true);
    expect(row.totp_secret_enc).not.toContain(en.secret);
  });
});
