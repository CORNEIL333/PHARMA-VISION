/**
 * U-03 : matrice des droits (spec §6), UNIQUE source de vérité.
 * 'O' = autorisé, 'R' = autorisé avec ré-authentification de moins de 5 minutes, '-' = refusé.
 */
export const ROLES = ['titulaire', 'pharmacien', 'preparateur', 'caissier'] as const;
export type Role = (typeof ROLES)[number];
export type Grant = 'O' | 'R' | '-';

export const MATRIX = {
  //                               titulaire pharmacien préparateur caissier
  'sale.sell': ['O', 'O', 'O', 'O'], // Vendre, encaisser, ouvrir et fermer sa caisse
  'prescription.validate': ['O', 'O', '-', '-'],
  'prescription.view_image': ['O', 'O', '-', '-'],
  'sale.void': ['R', 'R', '-', '-'],
  'sale.discount': ['O', 'O', '-', '-'],
  'cost.view': ['O', 'O', '-', '-'], // Voir les coûts et les marges
  'stock.receive': ['O', 'O', 'O', '-'],
  'order.manage': ['O', 'O', 'O', '-'], // Créer ou envoyer un bon de commande
  'stock.adjust': ['R', 'R', '-', '-'], // Ajuster ou détruire du stock
  'inventory.count': ['O', 'O', 'O', '-'],
  'inventory.validate': ['O', 'O', '-', '-'],
  'recall.create': ['R', 'R', '-', '-'],
  'price.edit': ['O', 'O', '-', '-'],
  'catalog.link': ['O', 'O', 'O', '-'], // Associer un code-barres, créer une fiche locale
  'demand.record': ['O', 'O', 'O', 'O'],
  'report.sales': ['O', 'O', '-', '-'], // Voir les rapports de ventes
  'report.stock': ['O', 'O', 'O', '-'], // … et de stock (préparateur : lecture stock)
  'cash.own_close_report': ['O', 'O', 'O', 'O'],
  'user.manage': ['R', '-', '-', '-'],
  'settings.edit': ['R', '-', '-', '-'],
  'backup.create': ['O', '-', '-', '-'],
  'backup.restore': ['R', '-', '-', '-'], // Restaurer, exporter le journal
  'ledger.export': ['R', '-', '-', '-'],
  'ledger.verify': ['O', 'O', '-', '-'],
  // Postes et application de bureau (annexe D) : génération du code d'appairage par pharmacien ou titulaire.
  'device.pairing_code': ['O', 'O', '-', '-'],
  'device.manage': ['R', '-', '-', '-'], // liste (O de fait) et révocation (R)
} as const satisfies Record<string, readonly [Grant, Grant, Grant, Grant]>;

export type Action = keyof typeof MATRIX;

export function grant(role: Role, action: Action): Grant {
  return MATRIX[action][ROLES.indexOf(role)] as Grant;
}

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/** Droits de l'utilisateur, renvoyés à l'interface (GET /auth/me) pour masquer ce qui est interdit. */
export function permissionsOf(role: Role): Record<Action, Grant> {
  const out = {} as Record<Action, Grant>;
  for (const a of Object.keys(MATRIX) as Action[]) out[a] = grant(role, a);
  return out;
}
