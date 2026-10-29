/** Types des réponses de l'API (annexe D), côté interface. */

export interface Product {
  id: string;
  ref_code: string | null;
  name: string;
  dci: string | null;
  strength: string | null;
  form: string | null;
  presentation: string | null;
  category: string;
  rx_required: boolean;
  sensitive: boolean;
  criticity: number;
  storage: string | null;
  suggested_price: number | null;
  sale_price: number | null;
  min_qty: number;
  max_qty: number;
  status: 'dormant' | 'active' | 'sleeping';
  local_only: boolean;
}

export interface ProductDetail extends Product {
  barcodes: { code: string; kind: string }[];
  lots: { id: string; lot_number: string; expiry: string | null; qty: number; unit_cost: number | null }[];
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface Gs1 {
  gtin: string | null;
  lot: string | null;
  expiry: string | null;
  serial: string | null;
}

export interface BarcodeLookup {
  found: boolean;
  code: string;
  gs1: Gs1 | null;
  product: Product | null;
}

export interface Alert {
  level: 'block' | 'warn';
  code: string;
  message: string;
}

export interface QuoteLine {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number | null;
  line_total: number;
  rx_required: boolean;
  sensitive: boolean;
  allocations: { lot_id: string; lot_number: string; expiry: string | null; qty: number; regul: boolean }[];
  alerts: Alert[];
}

export interface Quote {
  lines: QuoteLine[];
  gross: number;
  discount: number;
  total: number;
  rx_required: boolean;
  sensitive: boolean;
  regul_allowed: boolean;
  prescription: { ok: boolean; message: string | null };
  blocking: boolean;
}

export interface CashSession {
  id: string;
  register: string;
  kind: 'jour' | 'garde';
  opened_by: string;
  opened_by_name: string;
  opened_at: string;
  opening_float: number;
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
}

export interface Sale {
  id: string;
  number: string;
  total: number;
  gross: number;
  discount_total: number;
  status: 'completed' | 'voided';
  created_at: string;
  user_name: string;
  register: string;
  has_regul: boolean;
  change_given: number;
  prescription_id: string | null;
  short_hash: string | null;
  lines?: { product_id: string; name: string; lot_number: string; expiry: string | null; qty: number; unit_price: number; line_total: number; regul: boolean }[];
  payments?: { method: string; amount: number; reference: string | null; payer: string | null }[];
}

export interface Receipt {
  number: string;
  total: number;
  change: number;
  text: string;
  short_hash: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  lead_days: number;
  active: boolean;
}

export interface Prescription {
  id: string;
  prescriber_name: string;
  prescriber_reg: string | null;
  issued_on: string;
  patient_ref: string | null;
  has_image: boolean;
  age_days: number;
  validated_by_name: string;
}

export type Row = Record<string, string | number | boolean | null>;
