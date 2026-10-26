import { Type, type TSchema } from '@sinclair/typebox';
import { ROLES } from '../security/rbac.js';

/** Schémas communs (TypeBox). Tous les objets d'entrée refusent les propriétés inconnues. */
export const Obj = <T extends Record<string, TSchema>>(p: T) =>
  Type.Object(p, { additionalProperties: false });

export const Problem = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  code: Type.String(),
  detail: Type.Optional(Type.String()),
});

export const RoleT = Type.Union(ROLES.map((r) => Type.Literal(r)));
export const Uuid = Type.String({ format: 'uuid' });
export const Username = Type.String({ minLength: 3, maxLength: 32 });
export const Password = Type.String({ minLength: 1, maxLength: 256 });
export const TotpCode = Type.String({ pattern: '^[0-9]{6}$' });
export const DisplayName = Type.String({ minLength: 1, maxLength: 80 });

export const PublicUserT = Type.Object({
  id: Type.String(),
  username: Type.String(),
  display_name: Type.String(),
  role: RoleT,
  active: Type.Boolean(),
  totp_enabled: Type.Boolean(),
  must_change_pw: Type.Boolean(),
  created_at: Type.String(),
});

export const Ok = Type.Object({ ok: Type.Literal(true) });
