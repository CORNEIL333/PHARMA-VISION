import type { Services } from '../services.js';
import { fiscalMentions } from './profile.js';
import { getSettings } from './settings.js';
import { getSale, type Sale } from './sales.js';

/**
 * V-06 : contenu du ticket 80 mm (48 colonnes en police A). Le même contenu sert à l'impression
 * ESC/POS directe par l'application de bureau (W-06) et à l'impression du système (HTML).
 */

export const RECEIPT_WIDTH = 48;

export const METHOD_LABELS: Record<string, string> = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  carte: 'Carte',
  credit: 'Crédit',
  tiers_payant: 'Tiers payant',
};

export interface Receipt {
  pharmacy: { name: string; address: string; phone: string; niu: string | null; rccm: string | null };
  number: string;
  at: string;
  cashier: string;
  status: Sale['status'];
  lines: { name: string; lot_number: string; expiry: string | null; qty: number; unit_price: number; total: number }[];
  gross: number;
  discount: number;
  total: number;
  payments: { label: string; amount: number; reference: string | null }[];
  tendered: number | null;
  change: number;
  has_regul: boolean;
  short_hash: string;
  text: string;
}

export function formatXaf(n: number): string {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F`;
}

/** Date et heure de Douala au format JJ/MM/AAAA HH:MM. */
export function doualaDateTime(isoAt: string): string {
  const d = new Date(Date.parse(isoAt) + 3_600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
}

function center(t: string): string {
  const s = t.slice(0, RECEIPT_WIDTH);
  return ' '.repeat(Math.floor((RECEIPT_WIDTH - s.length) / 2)) + s;
}

function row(left: string, right: string): string {
  const room = RECEIPT_WIDTH - right.length - 1;
  return `${left.slice(0, room).padEnd(room)} ${right}`;
}

function renderText(r: Omit<Receipt, 'text'>): string {
  const out: string[] = [center(r.pharmacy.name)];
  if (r.pharmacy.address) out.push(center(r.pharmacy.address));
  if (r.pharmacy.phone) out.push(center(r.pharmacy.phone));
  if (r.pharmacy.niu) out.push(center(`NIU ${r.pharmacy.niu}`));
  if (r.pharmacy.rccm) out.push(center(`RCCM ${r.pharmacy.rccm}`));
  out.push('-'.repeat(RECEIPT_WIDTH), row(`Vente ${r.number}`, doualaDateTime(r.at)), `Caissier : ${r.cashier}`);
  if (r.status === 'voided') out.push(center('*** VENTE ANNULÉE ***'));
  out.push('-'.repeat(RECEIPT_WIDTH));
  for (const l of r.lines) {
    out.push(l.name.slice(0, RECEIPT_WIDTH));
    const lot = l.lot_number === '__REGUL__' ? 'Lot à régulariser' : `Lot ${l.lot_number}${l.expiry ? ` exp. ${l.expiry.slice(5, 7)}/${l.expiry.slice(0, 4)}` : ''}`;
    out.push(row(`  ${lot}`, `${l.qty} x ${formatXaf(l.unit_price)} = ${formatXaf(l.total)}`));
  }
  out.push('-'.repeat(RECEIPT_WIDTH));
  if (r.discount > 0) out.push(row('Sous-total', formatXaf(r.gross)), row('Remise', `-${formatXaf(r.discount)}`));
  out.push(row('TOTAL', formatXaf(r.total)));
  for (const p of r.payments) out.push(row(`${p.label}${p.reference ? ` (${p.reference})` : ''}`, formatXaf(p.amount)));
  if (r.tendered !== null) out.push(row('Espèces remises', formatXaf(r.tendered)), row('Rendu', formatXaf(r.change)));
  out.push('-'.repeat(RECEIPT_WIDTH), center(`Réf. journal ${r.short_hash}`), center('Merci de votre visite'));
  return out.join('\n');
}

export function buildReceipt(s: Services, saleId: string): Receipt {
  const sale = getSale(s, saleId);
  const st = getSettings(s);
  const base: Omit<Receipt, 'text'> = {
    pharmacy: { name: st.pharmacy_name, address: st.pharmacy_address, phone: st.pharmacy_phone, ...fiscalMentions(s) },
    number: sale.number,
    at: sale.created_at,
    cashier: sale.user_name,
    status: sale.status,
    lines: sale.lines.map((l) => ({
      name: l.name, lot_number: l.lot_number, expiry: l.expiry, qty: l.qty, unit_price: l.unit_price, total: l.line_total,
    })),
    gross: sale.gross,
    discount: sale.discount_total,
    total: sale.total,
    payments: sale.payments.map((p) => ({ label: METHOD_LABELS[p.method] ?? p.method, amount: p.amount, reference: p.reference })),
    tendered: sale.cash_tendered,
    change: sale.change_given,
    has_regul: sale.has_regul,
    short_hash: sale.short_hash ?? '',
  };
  return { ...base, text: renderText(base) };
}
