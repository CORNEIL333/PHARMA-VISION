import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { grant, type Action } from '../security/rbac.js';

/** Identifiant de l'utilisateur de la session (la permission a déjà été contrôlée en preValidation). */
export function actorOf(req: FastifyRequest): string {
  if (!req.auth) throw new AppError('unauthenticated', 'Session absente ou expirée');
  return req.auth.userId;
}

/** Vrai si le rôle de la session a l'action sans restriction (lecture conditionnelle : coûts, images…). */
export function can(req: FastifyRequest, action: Action): boolean {
  return req.auth !== null && grant(req.auth.role, action) !== '-';
}
