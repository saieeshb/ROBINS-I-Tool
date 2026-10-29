import type { FastifyInstance } from 'fastify';
import type { AiTask } from '@robercop/shared';
import { actorOf } from '../app.js';
import type { Services } from '../services/index.js';
import type { TaskScope } from '../ai/context.js';

type Params = { id: string };

export async function aiRoutes(app: FastifyInstance, s: Services): Promise<void> {
  app.get<{ Querystring: { refresh?: string } }>('/ai/status', async (req) => {
    const status = await s.ai.status(req.query.refresh === '1');
    const docling = await s.parsing.doclingStatus(req.query.refresh === '1');
    return { assistant: status, usage: s.ai.lastUsage, settings: s.settings().ai, docling, connector: s.ai.name };
  });

  app.post<{ Body: { task: AiTask; studyId: string; assessmentId?: string | null; scope?: TaskScope } }>('/ai/runs', async (req) => s.ai.start(req.body, actorOf(req)));
  app.get<{ Params: Params }>('/ai/runs/:id', async (req) => ({ run: s.store.aiRuns.require(req.params.id), proposals: s.proposals.forRun(req.params.id) }));
  app.get<{ Querystring: { studyId: string; assessmentId?: string } }>('/ai/runs', async (req) =>
    s.store.aiRuns
      .find({ study_id: req.query.studyId }, 'created_at DESC')
      .filter((r) => (req.query.assessmentId ? r.assessmentId === req.query.assessmentId : r.assessmentId === null))
      .slice(0, 50)
      .map((run) => ({ run, proposals: s.proposals.forRun(run.id) }))
  );
  app.post<{ Params: Params }>('/ai/runs/:id/cancel', async (req) => {
    s.ai.cancel(req.params.id, actorOf(req));
    return s.store.aiRuns.require(req.params.id);
  });

  /** Server-sent events for a run: status, streamed text, tool activity, usage and the final result. */
  app.get<{ Params: Params }>('/ai/runs/:id/events', async (req, reply) => {
    const run = s.store.aiRuns.require(req.params.id);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (!['queued', 'running'].includes(run.status)) {
      send({ type: 'done', run, proposals: s.proposals.forRun(run.id) });
      res.end();
      return;
    }
    send({ type: 'status', status: run.status });
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    const unsubscribe = s.ai.subscribe(run.id, (e) => {
      send(e);
      if (e.type === 'done') {
        clearInterval(ping);
        unsubscribe();
        res.end();
      }
    });
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.post<{ Params: Params; Body: { quote?: string; interpretation?: string; questionIds?: string[]; theme?: string } }>('/proposals/:id/accept', async (req) =>
    s.proposals.accept(req.params.id, req.body ?? {}, actorOf(req))
  );
  app.post<{ Params: Params }>('/proposals/:id/reject', async (req) => s.proposals.reject(req.params.id, actorOf(req)));
}
