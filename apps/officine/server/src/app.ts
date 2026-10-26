import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { SecureServerOptions } from 'node:http2';
import type { ServerOptions as HttpsOptions } from 'node:https';
import { AuthService } from './domain/auth.js';
import { registerHooks } from './http/hooks.js';
import { registerErrorHandling } from './http/problem.js';
import { authRoutes } from './http/routes/auth.js';
import { systemRoutes } from './http/routes/system.js';
import { userRoutes } from './http/routes/users.js';
import type { Services } from './services.js';

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
  registerErrorHandling(app);
  registerHooks(app, s);

  const authSvc = new AuthService(s);
  systemRoutes(app, s);
  authRoutes(app, s, authSvc);
  userRoutes(app, s);

  await app.ready();
  return app;
}
