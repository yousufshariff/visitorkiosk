import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { kioskAuth } from './auth';
import type { Deps } from './deps';
import { AppError } from './errors';
import { registerRoutes } from './routes';

const body = (code: string, message: string) => ({ error: { code, message } });

export function buildApp(opts: { deps: Deps; keyHashes: string[]; staticDir?: string }): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  app.addHook('onRequest', kioskAuth(opts.keyHashes));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send(body(err.code, err.message));
    if (err instanceof ZodError) return reply.code(400).send(body('invalid_request', 'Some of the details were missing or not valid.'));
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413) return reply.code(413).send(body('payload_too_large', 'That upload is too large.'));
    if (status && status >= 400 && status < 500) return reply.code(400).send(body('invalid_request', 'The request could not be understood.'));
    // Log the message only: SQL text, bodies and photo data stay out of logs and responses.
    console.error('[server] unexpected error:', err instanceof Error ? err.message : 'unknown');
    return reply.code(500).send(body('internal_error', 'Something went wrong. Please ask reception for help.'));
  });

  registerRoutes(app, opts.deps);

  if (opts.staticDir) void app.register(fastifyStatic, { root: opts.staticDir });
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (req.method === 'GET' && opts.staticDir && path !== '/api' && !path.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(body('not_found', 'Not found.'));
  });
  return app;
}
