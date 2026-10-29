import { randomUUID } from 'node:crypto';
import { openCashSession } from '../src/domain/cash.js';
import { createSale, type PaymentInput, type SaleLineInput } from '../src/domain/sales.js';
import { seedProduct, type SeedProduct } from './catalog.helpers.js';
import type { TestApp } from './helpers.js';
import { receive } from './stock.helpers.js';

/** Aides du module Caisse (J6). */

/** Produit actif avec un prix et un lot en stock. */
export function stockedProduct(
  t: TestApp,
  actor: string,
  opts: Partial<SeedProduct> & { qty?: number; expiry?: string; lot?: string; cost?: number } = {},
): { productId: string; lotId: string } {
  const productId = randomUUID();
  seedProduct(t.db, { id: productId, name: opts.name ?? 'Produit vendu', category: 'parapharmacie', rx: 0, sale: 1000, ...opts });
  const lotId = receive(t.s, actor, {
    productId, lotNumber: opts.lot ?? 'L1', qty: opts.qty ?? 10, expiry: opts.expiry ?? '2028-06-30', unitCost: opts.cost ?? 600, confirmNearExpiry: true,
  }).lotId;
  return { productId, lotId };
}

export function openRegister(t: TestApp, actor: string, register = 'Comptoir 1', float = 10_000): string {
  return openCashSession(t.s, actor, { register, opening_float: float }).id;
}

export const cash = (amount: number): PaymentInput[] => [{ method: 'especes', amount }];

export function sell(t: TestApp, actor: string, session: string, lines: SaleLineInput[], total: number, extra = {}) {
  return createSale(t.s, actor, { cash_session_id: session, lines, payments: cash(total), ...extra });
}
