import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { safeEqual } from '../security/crypto.js';
import { grant, MATRIX, type Action } from '../security/rbac.js';
import { RateLimiter } from '../security/ratelimit.js';
import { lookupSession, reauthValid } from '../security/sessions.js';
import type { Services } from '../services.js';
import { isSetupDone } from '../domain/setup.js';
import type { RouteInfo, RoutePermission } from './types.js';

export const SESSION_COOKIE = 'vp_sid';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** A-08 : en-têtes de sécurité sur toutes les réponses. */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy':
    'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

export function registerHooks(app: FastifyInstance, s: Services): void {
  const limiter = new RateLimiter(10, 60_000, () => s.clock.now().getTime());
  let setupDone = isSetupDone(s);

  app.decorateRequest('auth', null);
  const table: RouteInfo[] = [];
  app.decorate('routeTable', table);

  // Chaque route doit déclarer une permission connue ; sinon le serveur refuse de démarrer.
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/')) return;
    const perm = (route.config as { permission?: string } | undefined)?.permission;
    if (!perm) throw new Error(`Route sans permission déclarée : ${route.method} ${route.url}`);
    if (perm !== 'public' && perm !== 'session' && !(perm in MATRIX)) {
      throw new Error(`Permission inconnue « ${perm} » sur ${route.method} ${route.url}`);
    }
    for (const m of [route.method].flat())
      if (m !== 'HEAD') table.push({ method: m, url: route.url, permission: perm as RoutePermission });
  });

  app.addHook('onSend', async (req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  // preValidation : contrôle d'accès AVANT la validation du corps (CSRF et droits d'abord, aucun schéma divulgué).
  app.addHook('preValidation', async (req: FastifyRequest) => {
    const cfg = req.routeOptions.config;
    if (!req.url.startsWith('/api/') || !cfg.permission) return;

    if (cfg.rateLimited && !limiter.take(`${req.routeOptions.url}|${req.ip}`)) {
      throw new AppError('rate_limited', 'Trop de tentatives', 'Patientez une minute avant de réessayer.');
    }
    if (!setupDone) setupDone = isSetupDone(s);
    if (!setupDone && !cfg.beforeSetup) {
      throw new AppError('setup_required', 'Configuration initiale requise');
    }

    req.auth = lookupSession(s, req.cookies[SESSION_COOKIE]);
    if (cfg.permission === 'public') return;
    const a = req.auth;
    if (!a) throw new AppError('unauthenticated', 'Session absente ou expirée');

    if (MUTATING.has(req.method)) {
      const h = req.headers['x-csrf-token'];
      if (typeof h !== 'string' || !safeEqual(h, a.csrf))
        throw new AppError('csrf_failed', 'Jeton CSRF absent ou incorrect');
    }
    if (a.restriction && !cfg.restrictedOk) {
      throw a.restriction === 'password_change'
        ? new AppError('password_change_required', 'Changement de mot de passe obligatoire')
        : new AppError('totp_enrollment_required', 'Activation de la double authentification obligatoire');
    }
    if (cfg.permission === 'session') return;
    const g = grant(a.role, cfg.permission as Action);
    if (g === '-') throw new AppError('forbidden', 'Action non autorisée pour votre rôle');
    if (g === 'R' && !reauthValid(s, a)) throw new AppError('reauth_required', 'Ré-authentification requise');
  });
}
