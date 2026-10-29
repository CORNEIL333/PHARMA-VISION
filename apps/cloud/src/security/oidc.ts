import { jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * BO-01 : jeton d'accès Keycloak (OIDC, code d'autorisation + PKCE côté back-office). Vérifiés ici :
 * signature (JWKS du realm), émetteur, audience, expiration, et authentification multifacteur
 * (`amr` contient `otp`, ajouté par le mappeur « Authentication Method Reference » de Keycloak).
 */

export const BO_ROLES = ['admin', 'referentiel', 'support', 'lecture'] as const;
export type BoRole = (typeof BO_ROLES)[number];

export interface StaffIdentity {
  sub: string;
  username: string;
  roles: BoRole[];
}

export type TokenCheck = { ok: true; identity: StaffIdentity } | { ok: false; reason: 'invalid_token' | 'mfa_required' | 'no_role' };

export async function verifyStaffToken(
  token: string,
  keys: JWTVerifyGetKey,
  opts: { issuer: string; audience: string; now?: Date },
): Promise<TokenCheck> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer: opts.issuer, audience: opts.audience, algorithms: ['RS256', 'ES256', 'EdDSA'], currentDate: opts.now, clockTolerance: 30,
    }));
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
  const amr = Array.isArray(payload.amr) ? (payload.amr as unknown[]) : [];
  if (!amr.includes('otp')) return { ok: false, reason: 'mfa_required' };
  const realm = (payload.realm_access as { roles?: unknown } | undefined)?.roles;
  const roles = (Array.isArray(realm) ? realm : []).filter((r): r is BoRole => (BO_ROLES as readonly unknown[]).includes(r));
  if (roles.length === 0) return { ok: false, reason: 'no_role' };
  return { ok: true, identity: { sub: String(payload.sub), username: String(payload.preferred_username ?? payload.sub), roles } };
}
