import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';

/** Erreurs au format RFC 9457 (application/problem+json) avec un code stable (annexe D). */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      reply
        .status(err.status)
        .type('application/problem+json')
        .send({
          type: 'about:blank',
          title: err.title,
          status: err.status,
          code: err.code,
          detail: err.message,
          ...(err.extra ?? {}),
        });
      return;
    }
    const fe = err as FastifyError;
    if (fe.validation) {
      reply.status(400).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Requête invalide',
        status: 400,
        code: 'validation_failed',
        detail: fe.message,
      });
      return;
    }
    if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
      const code = fe.statusCode === 404 ? 'not_found' : fe.statusCode === 413 ? 'payload_too_large' : 'validation_failed';
      reply
        .status(fe.statusCode)
        .type('application/problem+json')
        .send({
          type: 'about:blank',
          title: 'Requête refusée',
          status: fe.statusCode,
          code,
          detail: fe.message,
        });
      return;
    }
    req.log.error({ err }, 'erreur interne');
    reply.status(500).type('application/problem+json').send({
      type: 'about:blank',
      title: 'Erreur interne',
      status: 500,
      code: 'internal_error',
      detail: 'Une erreur interne est survenue. Elle a été journalisée.',
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply
      .status(404)
      .type('application/problem+json')
      .send({ type: 'about:blank', title: 'Introuvable', status: 404, code: 'not_found' });
  });
}
