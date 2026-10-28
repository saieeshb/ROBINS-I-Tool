import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ConflictError, NotFoundError, ValidationError } from './db/database.js';
import type { Services } from './services/index.js';
import { coreRoutes } from './routes/core.js';
import { assessmentRoutes } from './routes/assess.js';
import { aiRoutes } from './routes/ai.js';
import { ioRoutes } from './routes/io.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: string;
  }
}

/** Reviewer name for attribution (local, not authenticated). Required for every change. */
export function actorOf(req: FastifyRequest): string {
  const raw = req.headers['x-reviewer'];
  const name = decodeURIComponent(String(Array.isArray(raw) ? raw[0] : raw ?? '')).trim();
  if (!name) throw new ValidationError('Choose who is reviewing (top right) before making changes.');
  return name;
}

export async function buildApp(services: Services, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });

  const port = services.config.port;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1', 'localhost', `[::1]:${port}`]);

  // Local-only protections: reject requests whose Host is not loopback (DNS rebinding), and require a custom header on
  // every state-changing API call so other websites cannot trigger actions (the header forces a CORS preflight that is
  // never granted).
  app.addHook('onRequest', async (req, reply) => {
    const host = String(req.headers.host ?? '');
    if (!allowedHosts.has(host) && process.env.ROBERCOP_ALLOW_ANY_HOST !== '1') {
      return reply.code(403).send({ error: 'ROBer COP only accepts local connections.' });
    }
    if (req.url.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method) && req.headers['x-robercop'] !== '1') {
      return reply.code(403).send({ error: 'Missing X-Robercop header.' });
    }
  });

  app.setErrorHandler((err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message, details: err.details ?? null });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message, current: err.current });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    app.log.error(err);
    return reply.code(500).send({ error: e.message ?? 'Unexpected error' });
  });

  await app.register(async (api) => {
    await coreRoutes(api, services);
    await assessmentRoutes(api, services);
    await aiRoutes(api, services);
    await ioRoutes(api, services);
  }, { prefix: '/api' });

  const web = services.config.webDist;
  if (web && existsSync(join(web, 'index.html'))) {
    await app.register(fastifyStatic, { root: web, prefix: '/', wildcard: false });
    const index = readFileSync(join(web, 'index.html'), 'utf8');
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.type('text/html').send(index);
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return app;
}
