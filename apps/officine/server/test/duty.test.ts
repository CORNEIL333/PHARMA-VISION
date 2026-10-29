import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDuty, isOnDuty, listDuty } from '../src/domain/duty.js';
import { AppError } from '../src/errors.js';
import { verifyLedger } from '../src/domain/verify.js';
import {
  createAndLogin,
  keyMap,
  makeApp,
  reauth,
  setupTitulaire,
  STRONG,
  type TestApp,
} from './helpers.js';

// Task 14 must register dutyRoutes and expose isOnDuty(s) as health.on_duty.
let t: TestApp;
let tit: Awaited<ReturnType<typeof setupTitulaire>>;
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => {
  vi.restoreAllMocks();
  t.cleanup();
});
const period = { starts_at: '2026-10-27T20:00:00.000Z', ends_at: '2026-10-28T08:00:00.000Z' };
const headers = () => ({ cookie: tit.cookie, 'x-csrf-token': tit.csrf });
const events = () => t.db.prepare("SELECT actor, payload FROM events WHERE type = 'duty.declared' ORDER BY seq")
  .all() as { actor: string; payload: string }[];

describe('G-01 duty periods', () => {
  it('G-01 declares a real period with creator/time and an atomic ledger event', () => {
    const d = declareDuty(t.s, tit.userId, period);
    expect(d).toMatchObject({ ...period, created_by: tit.userId, created_at: t.clock.now().toISOString() });
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(listDuty(t.s)).toEqual([d]);
    expect(events()).toHaveLength(1);
    expect(events()[0]?.actor).toBe(tit.userId);
    expect(JSON.parse(events()[0]!.payload)).toEqual({ duty_id: d.id, ...period });
    expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
  });

  it('G-01 calculates duty from the injected clock: inclusive start, exclusive end', () => {
    expect(isOnDuty(t.s)).toBe(false);
    declareDuty(t.s, tit.userId, period);
    t.clock.set('2026-10-27T19:59:59.999Z');
    expect(isOnDuty(t.s)).toBe(false);
    t.clock.set(period.starts_at);
    expect(isOnDuty(t.s)).toBe(true);
    t.clock.set('2026-10-28T07:59:59.999Z');
    expect(isOnDuty(t.s)).toBe(true);
    t.clock.set(period.ends_at);
    expect(isOnDuty(t.s)).toBe(false);
    expect(events()).toHaveLength(1);
  });

  it('G-01 overlapping periods are a union, listed deterministically, not double-counted', () => {
    const first = declareDuty(t.s, tit.userId, period);
    const second = declareDuty(t.s, tit.userId, { starts_at: '2026-10-28T07:00:00Z', ends_at: '2026-10-28T09:00:00Z' });
    expect(listDuty(t.s)).toEqual([second, first]);
    t.clock.set(period.ends_at);
    expect(isOnDuty(t.s)).toBe(true);
    t.clock.set(second.ends_at);
    expect(isOnDuty(t.s)).toBe(false);
  });

  it('G-01 normalizes timezone offsets before chronological comparison/storage', () => {
    const d = declareDuty(t.s, tit.userId, { starts_at: '2026-10-27T21:00:00+01:00', ends_at: '2026-10-27T20:30:00Z' });
    expect(d.starts_at).toBe('2026-10-27T20:00:00.000Z');
    expect(d.ends_at).toBe('2026-10-27T20:30:00.000Z');
    expect(() => declareDuty(t.s, tit.userId, { starts_at: '2026-10-27T20:00:00Z', ends_at: '2026-10-27T21:00:00+01:00' })).toThrow(AppError);
  });

  it('G-01 rejects equal/reversed bounds, impossible calendar dates and timezone-less input', () => {
    for (const p of [
      { starts_at: period.starts_at, ends_at: period.starts_at },
      { starts_at: period.ends_at, ends_at: period.starts_at },
      { starts_at: '2026-02-30T00:00:00Z', ends_at: '2026-03-02T00:00:00Z' },
      { starts_at: '2026-02-29T00:00:00Z', ends_at: '2026-03-02T00:00:00Z' },
      { starts_at: '2026-10-27', ends_at: period.ends_at },
      { starts_at: '2026-10-27T20:00:00', ends_at: period.ends_at },
      { starts_at: '2026-10-27T24:00:00Z', ends_at: period.ends_at },
      { starts_at: 'invalid', ends_at: period.ends_at },
    ]) {
      expect(() => declareDuty(t.s, tit.userId, p), JSON.stringify(p)).toThrow(AppError);
    }
    expect(listDuty(t.s)).toEqual([]);
    expect(events()).toEqual([]);
  });

  it('G-01 rolls back the period if the ledger fails', () => {
    const head = t.ledger.head();
    vi.spyOn(t.ledger, 'append').mockImplementation(() => { throw new Error('audit unavailable'); });
    expect(() => declareDuty(t.s, tit.userId, period)).toThrow('audit unavailable');
    expect(listDuty(t.s)).toEqual([]);
    expect(t.ledger.head()).toEqual(head);
  });

  it('G-01 HTTP declares/lists with settings.edit and rejects other roles', async () => {
    const noReauth = await t.app.inject({ method: 'POST', url: '/api/v1/duty', headers: headers(), payload: period });
    expect(noReauth.json()).toMatchObject({ code: 'reauth_required' });
    for (const role of ['pharmacien', 'preparateur', 'caissier']) {
      const a = await createAndLogin(t, tit, `duty-${role}`, role);
      const H = { cookie: a.cookie, 'x-csrf-token': a.csrf };
      expect((await t.app.inject({ method: 'POST', url: '/api/v1/duty', headers: H, payload: period })).statusCode, role).toBe(403);
      expect((await t.app.inject({ url: '/api/v1/duty', headers: H })).statusCode, role).toBe(403);
    }
    await reauth(t, tit, STRONG, tit.totpSecret);
    const created = await t.app.inject({ method: 'POST', url: '/api/v1/duty', headers: headers(), payload: period });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject(period);
    const listed = await t.app.inject({ url: '/api/v1/duty', headers: headers() });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([created.json()]);
    t.clock.advance(300_000);
    expect((await t.app.inject({ url: '/api/v1/duty', headers: headers() })).json()).toMatchObject({ code: 'reauth_required' });
  });

  it('G-01 HTTP rejects unknown input keys and invalid periods without writing', async () => {
    await reauth(t, tit, STRONG, tit.totpSecret);
    for (const payload of [
      { ...period, created_by: tit.userId },
      { ...period, ends_at: period.starts_at },
      { ...period, starts_at: '2026-02-30T00:00:00Z' },
      { starts_at: period.starts_at },
    ]) {
      const r = await t.app.inject({ method: 'POST', url: '/api/v1/duty', headers: headers(), payload });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ code: 'validation_failed' });
    }
    expect(events()).toHaveLength(0);
  });

  it('G-01 health exposes computed on_duty without leaking periods or requiring a user', async () => {
    expect((await t.app.inject({ url: '/api/v1/health' })).json()).toMatchObject({ on_duty: false });
    declareDuty(t.s, tit.userId, period);
    t.clock.set(period.starts_at);
    const active = await t.app.inject({ url: '/api/v1/health' });
    expect(active.statusCode).toBe(200);
    expect(active.json()).toMatchObject({ on_duty: true });
    expect(active.body).not.toContain(tit.userId);
    expect(active.body).not.toContain(period.starts_at);
    t.clock.set(period.ends_at);
    expect((await t.app.inject({ url: '/api/v1/health' })).json()).toMatchObject({ on_duty: false });
  });

  it('A-06 G-01 duty mutation always requires CSRF before body validation', async () => {
    for (const csrf of [undefined, 'incorrect']) {
      const H = { cookie: tit.cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) };
      const r = await t.app.inject({ method: 'POST', url: '/api/v1/duty', headers: H, payload: {} });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({ code: 'csrf_failed' });
    }
    expect(events()).toHaveLength(0);
  });
});
