import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { AppError } from '../../errors.js';
import type { AuthService } from '../../domain/auth.js';
import { changeOwnPassword, getUser } from '../../domain/users.js';
import { verifyPassword } from '../../security/passwords.js';
import { permissionsOf } from '../../security/rbac.js';
import { deleteSession, reauthValid } from '../../security/sessions.js';
import type { Services } from '../../services.js';
import { clearSessionCookie, setSessionCookie } from '../cookies.js';
import { Obj, Ok, Password, RoleT, TotpCode, Username } from '../schemas.js';

const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] ?? null });
const auth = (req: FastifyRequest) => {
  if (!req.auth) throw new AppError('unauthenticated', 'Session absente ou expirée');
  return req.auth;
};

const LoginResp = Type.Union([
  Type.Object({ status: Type.Literal('ok'), csrf: Type.String() }),
  Type.Object({ status: Type.Literal('totp_required'), challenge: Type.String() }),
]);

export function authRoutes(app: FastifyInstance, s: Services, authSvc: AuthService): void {
  app.post(
    '/api/v1/auth/login',
    {
      config: { permission: 'public', rateLimited: true },
      schema: { body: Obj({ username: Username, password: Password }), response: { 200: LoginResp } },
    },
    async (req, reply) => {
      const b = req.body as { username: string; password: string };
      const r = await authSvc.login(b.username, b.password, meta(req));
      if (r.kind === 'totp') return { status: 'totp_required' as const, challenge: r.challenge };
      setSessionCookie(reply, r.token, s);
      return { status: 'ok' as const, csrf: r.csrf };
    },
  );

  app.post(
    '/api/v1/auth/totp',
    {
      config: { permission: 'public', rateLimited: true },
      schema: {
        body: Obj({ challenge: Type.String({ maxLength: 100 }), code: TotpCode }),
        response: { 200: LoginResp },
      },
    },
    async (req, reply) => {
      const b = req.body as { challenge: string; code: string };
      const r = await authSvc.totp(b.challenge, b.code, meta(req));
      if (r.kind !== 'session') throw new AppError('internal_error', 'État inattendu');
      setSessionCookie(reply, r.token, s);
      return { status: 'ok' as const, csrf: r.csrf };
    },
  );

  app.post(
    '/api/v1/auth/reauth',
    {
      config: { permission: 'session', rateLimited: true },
      schema: {
        body: Obj({
          password: Password,
          code: Type.Optional(TotpCode),
          purpose: Type.Optional(Type.String({ maxLength: 60 })),
        }),
        response: { 200: Ok },
      },
    },
    async (req) => {
      const b = req.body as { password: string; code?: string; purpose?: string };
      await authSvc.reauth(auth(req), b.password, b.code, meta(req), b.purpose);
      return { ok: true as const };
    },
  );

  app.post(
    '/api/v1/auth/logout',
    { config: { permission: 'session', restrictedOk: true }, schema: { response: { 200: Ok } } },
    async (req, reply) => {
      deleteSession(s, auth(req).tokenHash);
      clearSessionCookie(reply);
      return { ok: true as const };
    },
  );

  app.get(
    '/api/v1/auth/me',
    {
      config: { permission: 'session', restrictedOk: true },
      schema: {
        response: {
          200: Type.Object({
            id: Type.String(),
            username: Type.String(),
            display_name: Type.String(),
            role: RoleT,
            csrf: Type.String(),
            restriction: Type.Union([
              Type.Literal('password_change'),
              Type.Literal('totp_enrollment'),
              Type.Null(),
            ]),
            reauth_valid: Type.Boolean(),
            permissions: Type.Record(
              Type.String(),
              Type.Union([Type.Literal('O'), Type.Literal('R'), Type.Literal('-')]),
            ),
          }),
        },
      },
    },
    async (req) => {
      const a = auth(req);
      return {
        id: a.userId,
        username: a.username,
        display_name: a.displayName,
        role: a.role,
        csrf: a.csrf,
        restriction: a.restriction,
        reauth_valid: reauthValid(s, a),
        permissions: permissionsOf(a.role),
      };
    },
  );

  app.post(
    '/api/v1/auth/password',
    {
      config: { permission: 'session', restrictedOk: true, rateLimited: true },
      schema: { body: Obj({ current_password: Password, new_password: Password }), response: { 200: Ok } },
    },
    async (req) => {
      const a = auth(req);
      const b = req.body as { current_password: string; new_password: string };
      if (!(await verifyPassword(b.current_password, getUser(s, a.userId).pw_hash))) {
        throw new AppError('invalid_credentials', 'Mot de passe actuel incorrect');
      }
      await changeOwnPassword(s, a.userId, a.tokenHash, b.new_password);
      return { ok: true as const };
    },
  );

  app.post(
    '/api/v1/auth/totp/enroll',
    {
      config: { permission: 'session', restrictedOk: true },
      schema: { response: { 200: Type.Object({ secret: Type.String(), otpauth_uri: Type.String() }) } },
    },
    async (req) => authSvc.beginTotpEnrollment(auth(req)),
  );

  app.post(
    '/api/v1/auth/totp/confirm',
    {
      config: { permission: 'session', restrictedOk: true },
      schema: { body: Obj({ code: TotpCode }), response: { 200: Ok } },
    },
    async (req) => {
      authSvc.confirmTotpEnrollment(auth(req), (req.body as { code: string }).code);
      return { ok: true as const };
    },
  );
}
