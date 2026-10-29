import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '../db/database.js';
import { actorOf } from '../app.js';
import type { Services } from '../services/index.js';
import type { PackageKind } from '../services/packages.js';

type Params = { id: string };

/** Viewer for read-only exports: the X-Reviewer header, or ?reviewer= for links opened in a new tab. */
function viewerOf(req: FastifyRequest): string {
  const raw = req.headers['x-reviewer'];
  const header = raw ? decodeURIComponent(String(Array.isArray(raw) ? raw[0] : raw)) : '';
  const query = (req.query as { reviewer?: string } | undefined)?.reviewer ?? '';
  return (header || query).trim();
}

function sendFile(reply: FastifyReply, filename: string, type: string, bytes: Uint8Array | Buffer | string) {
  return reply
    .type(type)
    .header('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .header('Cache-Control', 'no-store')
    .send(bytes);
}

async function uploaded(req: FastifyRequest): Promise<{ filename: string; bytes: Uint8Array; field: (name: string) => string | undefined }> {
  const file = await req.file();
  if (!file) throw new ValidationError('No file uploaded.');
  const bytes = new Uint8Array(await file.toBuffer());
  return {
    filename: file.filename,
    bytes,
    field: (name) => {
      const f = file.fields[name] as { value?: unknown } | undefined;
      return f && 'value' in f && f.value !== undefined ? String(f.value) : undefined;
    }
  };
}

export async function ioRoutes(app: FastifyInstance, s: Services): Promise<void> {
  // --- review packages ------------------------------------------------------------------------------------------
  app.get<{ Params: Params }>('/projects/:id/packages', async (req) => s.store.packages.find({ project_id: req.params.id }, 'created_at DESC'));

  app.post<{ Params: Params; Body: { studyId: string; kind: PackageKind; resultIds?: string[]; assessmentIds?: string[]; note?: string } }>('/projects/:id/packages/export', async (req, reply) => {
    const kinds: PackageKind[] = ['independent_assignment', 'checking_assignment', 'completed_review'];
    if (!kinds.includes(req.body?.kind)) throw new ValidationError('Choose what kind of package to export.');
    const { filename, bytes } = s.packages.export({ projectId: req.params.id, ...req.body }, actorOf(req));
    return sendFile(reply, filename, 'application/zip', bytes);
  });

  app.post('/packages/preview', async (req) => {
    const { bytes } = await uploaded(req);
    return s.packages.preview(bytes);
  });

  app.post<{ Body: { token: string; conflicts?: 'skip' | 'copy' } }>('/packages/commit', async (req) =>
    s.packages.commit(String(req.body?.token ?? ''), { conflicts: req.body?.conflicts === 'copy' ? 'copy' : 'skip' }, actorOf(req))
  );

  // --- legacy sessions (earlier HTML tool) -----------------------------------------------------------------------
  app.post<{ Params: Params }>('/projects/:id/legacy/preview', async (req) => {
    actorOf(req);
    const { filename, bytes, field } = await uploaded(req);
    return s.legacy.preview(req.params.id, filename, bytes, field('targetStudyId') || null);
  });

  app.post<{ Params: Params; Body: { token: string; targetStudyId?: string | null; reviewer?: string } }>('/projects/:id/legacy/commit', async (req) =>
    s.legacy.commit(req.params.id, String(req.body?.token ?? ''), { targetStudyId: req.body?.targetStudyId ?? null, reviewer: req.body?.reviewer }, actorOf(req))
  );

  // --- exports ---------------------------------------------------------------------------------------------------
  app.get<{ Params: Params; Querystring: { theme?: string } }>('/assessments/:id/report', async (req, reply) => {
    const theme = req.query.theme === 'dark' || req.query.theme === 'light' ? req.query.theme : null;
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(s.exports.assessmentReport(req.params.id, viewerOf(req), theme));
  });
  app.get<{ Params: Params }>('/assessments/:id/export.xlsx', async (req, reply) => {
    const { filename, bytes } = await s.exports.assessmentXlsx(req.params.id, viewerOf(req));
    return sendFile(reply, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  });
  app.get<{ Params: Params }>('/assessments/:id/export.json', async (req, reply) => {
    const data = s.exports.assessmentExportJson(req.params.id, viewerOf(req));
    return sendFile(reply, `ROBINS-I_${data.study.label}_${data.assessment.reviewer}.json`.replace(/[^\w.\- ]+/g, '_'), 'application/json', JSON.stringify(data, null, 2));
  });
  app.get<{ Params: Params }>('/projects/:id/export.xlsx', async (req, reply) => {
    const { filename, bytes } = await s.exports.projectXlsx(req.params.id, viewerOf(req));
    return sendFile(reply, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  });
  app.get<{ Params: Params }>('/projects/:id/export.json', async (req, reply) => {
    const data = s.exports.projectExportJson(req.params.id, viewerOf(req));
    return sendFile(reply, `ROBINS-I_${data.project.name}_${data.exportedAt.slice(0, 10)}.json`.replace(/[^\w.\- ]+/g, '_'), 'application/json', JSON.stringify(data, null, 2));
  });
}
