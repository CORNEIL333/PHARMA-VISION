import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SHOTS = path.resolve(here, '../../../../docs/screenshots');
export const PASSWORD = 'Bissap-Ndole-2026!';

export function state(): { dataDir: string; recoveryKey: string; fingerprint: string } {
  return JSON.parse(readFileSync(path.join(here, '.state.json'), 'utf8')) as ReturnType<typeof state>;
}

function base32Decode(s: string): Buffer {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Codes TOTP successifs jamais réutilisés (le serveur refuse le rejeu) : on prend le plus petit pas
 * accepté (tolérance ±1) supérieur au dernier utilisé, en attendant si nécessaire.
 */
export class Totp {
  private last = -Infinity;
  constructor(readonly secret: string) {}
  async next(): Promise<string> {
    for (;;) {
      const now = Math.floor(Date.now() / 30_000);
      const candidate = Math.max(this.last + 1, now - 1);
      if (candidate <= now + 1) {
        this.last = candidate;
        return hotp(base32Decode(this.secret), candidate);
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

/** Accessibilité : aucune violation sérieuse ni critique (A3). */
export async function axe(page: Page, name: string): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${name}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

/** Captures sombre et clair dans docs/screenshots (A3). */
export async function shots(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((th) => {
      document.documentElement.classList.toggle('dark', th === 'dark');
      document.documentElement.classList.toggle('light', th === 'light');
    }, theme);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${theme}.png`) });
    if (theme === 'light') await axe(page, `${name} (clair)`);
  }
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  });
}

/** Appels d'API avec la session de la page (cookies du contexte) et le jeton CSRF. */
export async function apiClient(request: APIRequestContext) {
  const me = await (await request.get('/api/v1/auth/me')).json() as { csrf: string };
  const h = { 'x-csrf-token': me.csrf };
  const check = async (r: Awaited<ReturnType<APIRequestContext['get']>>) => {
    if (!r.ok()) throw new Error(`${r.url()} ${r.status()} ${await r.text()}`);
    return r.json() as Promise<Record<string, unknown> & { id: string }>;
  };
  return {
    get: async (url: string) => check(await request.get(`/api/v1${url}`)),
    post: async (url: string, data?: unknown) => check(await request.post(`/api/v1${url}`, { headers: h, data: data ?? {} })),
    patch: async (url: string, data: unknown) => check(await request.patch(`/api/v1${url}`, { headers: h, data })),
    csv: async (url: string, body: Buffer) => check(await request.post(`/api/v1${url}`, { headers: { ...h, 'content-type': 'text/csv' }, data: body })),
  };
}
