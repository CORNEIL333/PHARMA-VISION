// W-02, W-03 : démarre un vrai serveur en TLS (nœud A) et initialise un nœud B (autre autorité), puis lance
// le test Rust d'épinglage contre A avec l'autorité de A (acceptée) et celle de B (refusée).
//   npm run desktop:pinning-test
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const tmp = mkdtempSync(path.join(tmpdir(), 'vp-pin-'));
const [a, b] = [path.join(tmp, 'a'), path.join(tmp, 'b')];
const port = process.env.VP_PIN_PORT ?? '18543';
let server;
try {
  for (const d of [a, b]) {
    const r = spawnSync(process.execPath, [tsx, 'scripts/init.ts', '--data', d, '--name', 'localhost'], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  }
  server = spawn(process.execPath, [tsx, 'server/src/main.ts'], {
    cwd: root,
    env: { ...process.env, VP_DATA_DIR: a, VP_PORT: port, VP_HOST: '127.0.0.1', VP_LOG_LEVEL: 'warn' },
    stdio: 'inherit',
  });
  const caA = path.join(a, 'tls', 'ca.pem');
  const fingerprint = new X509Certificate(readFileSync(caA)).fingerprint256;
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}`).then(() => true, (e) => e?.cause?.code !== 'ECONNREFUSED');
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const t = spawnSync('cargo', ['test', '--test', 'pinning', '--', '--nocapture'], {
    cwd: path.join(root, 'desktop', 'src-tauri'),
    env: {
      ...process.env,
      VP_PIN_ORIGIN: `localhost:${port}`,
      VP_PIN_CA: caA,
      VP_PIN_OTHER_CA: path.join(b, 'tls', 'ca.pem'),
      VP_PIN_FINGERPRINT: fingerprint,
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = t.status ?? 1;
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
