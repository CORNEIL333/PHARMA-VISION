import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { msUntilNextLocalMidnight } from '../src/jobs/checkpoints.js';
import { resolveTls } from '../src/tls.js';
import { initNode } from '../src/security/keys.js';

describe('I-05 TLS obligatoire', () => {
  it('I-05 refuse de démarrer sans certificat quand TLS est exigé (défaut)', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'vp-tls-'));
    try {
      expect(() => resolveTls(loadConfig({ VP_DATA_DIR: d }))).toThrow(/TLS obligatoire/);
      expect(resolveTls(loadConfig({ VP_DATA_DIR: d, VP_REQUIRE_TLS: 'false' }))).toBeNull();
      initNode(d, new Date(), { names: ['localhost'] });
      expect(resolveTls(loadConfig({ VP_DATA_DIR: d }))?.cert.toString()).toContain('BEGIN CERTIFICATE');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('I-05 une valeur ambiguë de VP_REQUIRE_TLS est refusée', () => {
    expect(() => loadConfig({ VP_REQUIRE_TLS: 'non' })).toThrow();
  });
});

describe('J-03 point de contrôle de minuit (Africa/Douala)', () => {
  it('J-03 23:00 UTC = 00:00 à Douala', () => {
    expect(msUntilNextLocalMidnight(new Date('2026-10-27T22:30:00.000Z'))).toBe(30 * 60_000);
    expect(msUntilNextLocalMidnight(new Date('2026-10-27T23:00:00.000Z'))).toBe(24 * 3_600_000);
  });
});
