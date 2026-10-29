import {
  Barcode, BookUser, ClipboardList, FileBarChart, HelpCircle, Lock, PackageCheck, PackageSearch, ShieldAlert, ShoppingCart, Truck, UsersRound,
  Wallet, Wrench, type LucideIcon,
} from 'lucide-react';
import { fr } from '../../i18n/fr';

/** Écrans et droits nécessaires (le serveur contrôle toujours ; ceci évite d'afficher l'inaccessible). */
export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Au moins une de ces actions de la matrice (spec §6). */
  any: string[];
}

export const NAV: NavItem[] = [
  { path: '/caisse', label: fr.nav.cashier, icon: ShoppingCart, any: ['sale.sell'] },
  { path: '/produits', label: fr.nav.products, icon: PackageSearch, any: ['sale.sell'] },
  { path: '/reception', label: fr.nav.reception, icon: Truck, any: ['stock.receive'] },
  { path: '/commandes', label: fr.nav.orders, icon: PackageCheck, any: ['order.manage'] },
  { path: '/inventaire', label: fr.nav.inventory, icon: ClipboardList, any: ['inventory.count'] },
  { path: '/rappels', label: fr.nav.recalls, icon: ShieldAlert, any: ['report.stock'] },
  { path: '/demandes', label: fr.nav.demand, icon: HelpCircle, any: ['demand.record'] },
  { path: '/rapports', label: fr.nav.reports, icon: FileBarChart, any: ['report.stock', 'report.sales', 'cash.own_close_report'] },
  { path: '/cloture', label: fr.nav.cashClose, icon: Wallet, any: ['sale.sell'] },
  { path: '/comptes', label: fr.nav.accounts, icon: UsersRound, any: ['user.manage'] },
  { path: '/systeme', label: fr.nav.system, icon: Wrench, any: ['ledger.verify', 'backup.create'] },
  { path: '/dossier', label: fr.dossier.title, icon: BookUser, any: ['settings.edit'] },
];

export const ICONS = { Barcode, Lock };

export function allowed(item: NavItem, can: (a: string) => boolean): boolean {
  return item.any.some(can);
}
