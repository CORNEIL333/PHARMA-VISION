import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.VP_E2E_PORT ?? 18443);

/**
 * Bout en bout contre un vrai serveur (base SQLite réelle, clés réelles) et l'interface buildée.
 * Les tests s'enchaînent dans un ordre fixe (configuration, puis usage) : un seul worker.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Africa/Douala',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'node ../node_modules/tsx/dist/cli.mjs e2e/start-server.ts',
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
