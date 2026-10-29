import type { BoRole } from './oidc.js';

/**
 * BO-02 : matrice unique rôle × action du back-office (moindre privilège). « J » = autorisé avec
 * justification obligatoire et journalisée (accès à une donnée nominative, BO-03), « O » = autorisé.
 */
type Grant = 'O' | 'J' | '-';

//                                   admin  referentiel support lecture
export const BO_MATRIX = {
  'network.read': ['O', 'O', 'O', 'O'],
  'node.revoke': ['O', '-', '-', '-'],
  'node.quarantine_lift': ['O', '-', '-', '-'],
  'enrolment.issue': ['O', '-', 'O', '-'],
  'pharmacy.read': ['O', 'O', 'O', 'O'],
  'pharmacy.read_personal': ['J', '-', 'J', '-'],
  'pharmacy.write': ['O', 'O', '-', '-'],
  'referential.write': ['O', 'O', '-', '-'],
  'referential.publish': ['O', 'O', '-', '-'],
  'recall.broadcast': ['O', 'O', '-', '-'],
  'recall.read': ['O', 'O', 'O', 'O'],
  'availability.read': ['O', 'O', 'O', 'O'],
  'transparency.read': ['O', 'O', 'O', 'O'],
  'audit.read': ['O', '-', '-', '-'],
} as const satisfies Record<string, readonly [Grant, Grant, Grant, Grant]>;

export type BoAction = keyof typeof BO_MATRIX;
const ORDER: BoRole[] = ['admin', 'referentiel', 'support', 'lecture'];

/** Droit le plus large parmi les rôles de la personne (O > J > -). */
export function boGrant(roles: BoRole[], action: BoAction): Grant {
  const grants = roles.map((r) => BO_MATRIX[action][ORDER.indexOf(r)] as Grant);
  return grants.includes('O') ? 'O' : grants.includes('J') ? 'J' : '-';
}
