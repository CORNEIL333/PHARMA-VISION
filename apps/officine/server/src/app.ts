import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { SecureServerOptions } from 'node:http2';
import type { ServerOptions as HttpsOptions } from 'node:https';
import { AuthService } from './domain/auth.js';
import { registerHooks } from './http/hooks.js';
import { registerErrorHandling } from './http/problem.js';
import { registerStatic } from './http/static.js';
import { authRoutes } from './http/routes/auth.js';
import { backupRoutes } from './http/routes/backup.js';
import { catalogRoutes } from './http/routes/catalog.js';
import { cloudRoutes } from './http/routes/cloud.js';
import { devicesRoutes } from './http/routes/devices.js';
import { dutyRoutes } from './http/routes/duty.js';
import { ordersRoutes } from './http/routes/orders.js';
import { receptionsRoutes } from './http/routes/receptions.js';
import { profileRoutes } from './http/routes/profile.js';
import { reportsRoutes } from './http/routes/reports.js';
import { safetyRoutes } from './http/routes/safety.js';
import { salesRoutes } from './http/routes/sales.js';
import { settingsRoutes } from './http/routes/settings.js';
import { stockRoutes } from './http/routes/stock.js';
import { systemRoutes } from './http/routes/system.js';
import { userRoutes } from './http/routes/users.js';
import type { Services } from './services.js';

/** I-04 : un import de 50 000 lignes doit passer ; le corps est un tampon, jamais un chemin. */
export const CSV_BODY_LIMIT = 50 * 1024 * 1024;

/** Construit l'instance Fastify (sans écouter) : utilisable telle quelle dans les tests (app.inject). */
export async function buildApp(
  s: Services,
  opts: { logger?: FastifyServerOptions['logger']; https?: HttpsOptions | SecureServerOptions } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    ...(opts.https ? { https: opts.https } : {}),
    trustProxy: false,
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
  } as FastifyServerOptions);

  await app.register(cookie);
  app.addContentTypeParser(
    ['text/csv', 'application/csv'],
    { parseAs: 'buffer', bodyLimit: CSV_BODY_LIMIT },
    (_req, body, done) => done(null, body),
  );
  registerErrorHandling(app);
  registerHooks(app, s);

  const authSvc = new AuthService(s);
  systemRoutes(app, s);
  authRoutes(app, s, authSvc);
  userRoutes(app, s);
  catalogRoutes(app, s);
  stockRoutes(app, s);
  ordersRoutes(app, s);
  receptionsRoutes(app, s);
  salesRoutes(app, s);
  safetyRoutes(app, s, authSvc);
  settingsRoutes(app, s);
  reportsRoutes(app, s);
  profileRoutes(app, s);
  backupRoutes(app, s);
  cloudRoutes(app, s);
  devicesRoutes(app, s);
  dutyRoutes(app, s);
  registerStatic(app, s.config.webDist);

  await app.ready();
  return app;
}
