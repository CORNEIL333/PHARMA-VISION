import { browserClientsAllowed, lookupDevice } from '../domain/devices.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';

export interface DevicePolicyRequest {
  method: string;
  url: string;
  headers: { 'x-vp-device'?: unknown };
  /** Cookie de poste `vp_dev` posé au démarrage de l'application de bureau (domain/desktop.ts). */
  deviceCookie?: unknown;
}

function exempt(request: DevicePolicyRequest): boolean {
  const path = request.url.split('?', 1)[0];
  if (request.method === 'POST') return path === '/api/v1/devices/pair';
  if (request.method === 'GET' && path === '/api/v1/devices/boot') return true;
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  return path === '/api/v1/health' || path === '/api/v1/desktop/update' ||
    /^\/api\/v1\/desktop\/packages\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(path ?? '');
}

/**
 * W-11 integration: call from a global onRequest hook, before every route (including static/404).
 * Do not put this after the permission/public early returns in the existing preValidation hook.
 * A device is not a user session: RBAC, reauth and CSRF must still run unchanged.
 * Status and setup are deliberately NOT exempt. Never log the header or the pairing body.
 */
export function enforceDevicePolicy(s: Services, request: DevicePolicyRequest): string | null {
  const device = lookupDevice(s, request.headers['x-vp-device'], true) ?? lookupDevice(s, request.deviceCookie, true);
  if (!device && !browserClientsAllowed(s) && !exempt(request)) {
    throw new AppError('forbidden', 'Poste appairé requis');
  }
  return device?.id ?? null;
}
