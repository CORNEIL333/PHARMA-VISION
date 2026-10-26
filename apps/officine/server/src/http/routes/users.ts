import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { AppError } from '../../errors.js';
import {
  createUser,
  listUsers,
  resetPassword,
  revokeSessions,
  setActive,
  updateUser,
} from '../../domain/users.js';
import type { Role } from '../../security/rbac.js';
import type { Services } from '../../services.js';
import { DisplayName, Obj, PublicUserT, RoleT, Username, Uuid } from '../schemas.js';

const actor = (req: FastifyRequest) => {
  if (!req.auth) throw new AppError('unauthenticated', 'Session absente ou expirée');
  return req.auth.userId;
};
const IdParams = Obj({ id: Uuid });

/** U-01 à U-03. Lecture : 'user.manage' sans ré-authentification n'existe pas dans la matrice → R partout. */
export function userRoutes(app: FastifyInstance, s: Services): void {
  app.get(
    '/api/v1/users',
    { config: { permission: 'user.manage' }, schema: { response: { 200: Type.Array(PublicUserT) } } },
    async () => listUsers(s),
  );

  app.post(
    '/api/v1/users',
    {
      config: { permission: 'user.manage' },
      schema: {
        body: Obj({ username: Username, display_name: DisplayName, role: RoleT }),
        response: { 201: Type.Object({ user: PublicUserT, temporary_password: Type.String() }) },
      },
    },
    async (req, reply) => {
      const b = req.body as { username: string; display_name: string; role: Role };
      return reply.status(201).send(await createUser(s, actor(req), b));
    },
  );

  app.patch(
    '/api/v1/users/:id',
    {
      config: { permission: 'user.manage' },
      schema: {
        params: IdParams,
        body: Obj({
          display_name: Type.Optional(DisplayName),
          role: Type.Optional(RoleT),
          active: Type.Optional(Type.Boolean()),
        }),
        response: { 200: PublicUserT },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const b = req.body as { display_name?: string; role?: Role; active?: boolean };
      let u = updateUser(s, actor(req), id, { display_name: b.display_name, role: b.role });
      if (b.active !== undefined) u = setActive(s, actor(req), id, b.active);
      return u;
    },
  );

  app.post(
    '/api/v1/users/:id/reset-password',
    {
      config: { permission: 'user.manage' },
      schema: { params: IdParams, response: { 200: Type.Object({ temporary_password: Type.String() }) } },
    },
    async (req) => resetPassword(s, actor(req), (req.params as { id: string }).id),
  );

  app.post(
    '/api/v1/users/:id/revoke-sessions',
    {
      config: { permission: 'user.manage' },
      schema: { params: IdParams, response: { 200: Type.Object({ revoked: Type.Integer() }) } },
    },
    async (req) => ({ revoked: revokeSessions(s, actor(req), (req.params as { id: string }).id) }),
  );
}
