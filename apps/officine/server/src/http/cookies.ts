import type { FastifyReply } from 'fastify';
import type { Services } from '../services.js';
import { SESSION_COOKIE } from './hooks.js';

/** A-05 : cookie vp_sid HttpOnly, Secure, SameSite=Strict, Path=/. */
export function setSessionCookie(reply: FastifyReply, token: string, s: Services): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: s.config.sessionMaxHours * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
}
