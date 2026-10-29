/**
 * Erreurs métier typées, avec un code stable (annexe D) et un statut HTTP.
 * Le domaine lève des AppError ; la couche HTTP les traduit en RFC 9457.
 */
export type ErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'reauth_required'
  | 'password_change_required'
  | 'totp_enrollment_required'
  | 'forbidden'
  | 'csrf_failed'
  | 'not_found'
  | 'setup_required'
  | 'setup_done'
  | 'weak_password'
  | 'invalid_totp'
  | 'last_titulaire'
  | 'username_taken'
  | 'insufficient_stock'
  | 'recalled_lot'
  | 'expired_lot'
  | 'rx_required'
  | 'register_busy'
  | 'invalid_transition'
  | 'payment_mismatch'
  | 'rate_limited'
  | 'db_busy'
  | 'internal_error'
  | 'barcode_taken'
  | 'invalid_barcode'
  | 'payload_too_large'
  | 'stale_prescription'
  | 'price_missing'
  | 'backup_invalid'
  | 'cloud_unreachable'
  | 'cloud_rejected';

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  reauth_required: 401,
  password_change_required: 403,
  totp_enrollment_required: 403,
  forbidden: 403,
  csrf_failed: 403,
  not_found: 404,
  setup_required: 409,
  setup_done: 409,
  weak_password: 422,
  invalid_totp: 422,
  last_titulaire: 409,
  username_taken: 409,
  insufficient_stock: 409,
  recalled_lot: 409,
  expired_lot: 409,
  rx_required: 409,
  register_busy: 409,
  invalid_transition: 409,
  payment_mismatch: 422,
  rate_limited: 429,
  db_busy: 503,
  internal_error: 500,
  barcode_taken: 409,
  invalid_barcode: 422,
  payload_too_large: 413,
  stale_prescription: 409,
  price_missing: 409,
  backup_invalid: 422,
  cloud_unreachable: 503,
  cloud_rejected: 502,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
  readonly extra: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, title: string, detail?: string, extra?: Record<string, unknown>) {
    super(detail ?? title);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.title = title;
    this.extra = extra;
  }
}
