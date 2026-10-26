import type { Action } from '../security/rbac.js';
import type { AuthContext } from '../security/sessions.js';

/**
 * Permission déclarée par CHAQUE route (AGENTS.md) :
 * - 'public'  : accessible sans session ;
 * - 'session' : toute session valide ;
 * - une action de la matrice (spec §6).
 */
export type RoutePermission = 'public' | 'session' | Action;

export interface RouteConfig {
  permission: RoutePermission;
  /** Route utilisable avant la configuration initiale. */
  beforeSetup?: boolean;
  /** Route utilisable par une session limitée (changement de mot de passe ou enrôlement TOTP imposé). */
  restrictedOk?: boolean;
  /** Limitation de débit par adresse IP (A-04). */
  rateLimited?: boolean;
}

export interface RouteInfo {
  method: string;
  url: string;
  permission: RoutePermission;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Table des routes /api et de leur permission (tests exhaustifs CSRF et droits). */
    routeTable: RouteInfo[];
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    permission?: RoutePermission;
    beforeSetup?: boolean;
    restrictedOk?: boolean;
    rateLimited?: boolean;
  }
}
