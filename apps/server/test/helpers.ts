import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createServices, type Services } from '../src/services/index.js';
import { buildApp } from '../src/app.js';

export const FIXTURE_PDF = resolve(__dirname, 'fixtures', 'sample-study.pdf');

export interface UploadFile {
  name: string;
  bytes: Buffer | Uint8Array;
  type?: string;
}

export interface TestEnv {
  app: FastifyInstance;
  services: Services;
  dataDir: string;
  api: <T = any>(method: string, url: string, body?: unknown, reviewer?: string) => Promise<{ status: number; body: T }>;
  upload: (url: string, file: string | UploadFile, fields: Record<string, string>, reviewer?: string) => Promise<{ status: number; body: any }>;
  /** Raw response (for downloads). */
  raw: (method: string, url: string, body?: unknown, reviewer?: string) => Promise<{ status: number; headers: Record<string, unknown>; bytes: Buffer; text: string }>;
  close: () => Promise<void>;
}

export async function setup(overrides: Record<string, unknown> = {}): Promise<TestEnv> {
  const dataDir = mkdtempSync(join(tmpdir(), 'robercop-test-'));
  const config = loadConfig({ dataDir, pythonPath: null, ...overrides });
  const services = createServices(config);
  const app = await buildApp(services);
  const host = `127.0.0.1:${config.port}`;
  const api = async (method: string, url: string, body?: unknown, reviewer = 'Alice') => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: { host, 'x-robercop': '1', 'x-reviewer': encodeURIComponent(reviewer), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body !== undefined ? JSON.stringify(body) : undefined
    });
    let parsed: unknown = res.body;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      /* non-JSON */
    }
    return { status: res.statusCode, body: parsed as any };
  };
  const raw = async (method: string, url: string, body?: unknown, reviewer = 'Alice') => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: { host, 'x-robercop': '1', 'x-reviewer': encodeURIComponent(reviewer), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body !== undefined ? JSON.stringify(body) : undefined
    });
    return { status: res.statusCode, headers: res.headers as Record<string, unknown>, bytes: res.rawPayload, text: res.body };
  };
  const upload = async (url: string, file: string | UploadFile, fields: Record<string, string>, reviewer = 'Alice') => {
    const f: UploadFile = typeof file === 'string' ? { name: file.split('/').pop()!, bytes: readFileSync(file), type: 'application/pdf' } : file;
    const boundary = '----robercop' + Math.random().toString(16).slice(2);
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`));
    parts.push(Buffer.from(f.bytes));
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { host, 'x-robercop': '1', 'x-reviewer': encodeURIComponent(reviewer), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat(parts)
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  return {
    app,
    services,
    dataDir,
    api,
    upload,
    raw,
    close: async () => {
      await app.close();
      services.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

/** Builds an approved study with one result, ready for Domain sessions. */
export async function approvedStudy(env: TestEnv, mode: 'independent' | 'checking') {
  const { api, upload } = env;
  const project = (await api('POST', '/api/projects', { name: `Esophagectomy review (${mode})`, verificationMode: mode })).body;
  const study = (await api('POST', `/api/projects/${project.id}/studies`, { label: 'Example 2021', citation: 'Example A, et al. Fictional cohort. 2021.' })).body;
  const up = await upload(`/api/studies/${study.id}/documents`, FIXTURE_PDF, { role: 'manuscript', label: 'Main article' });
  expect(up.status).toBe(200);
  await env.services.parsing.idle();
  const result = (await api('POST', `/api/studies/${study.id}/results`, { outcome: 'Anastomotic leak' })).body;
  expect(result.outcomeDomain).toBe('Anastomotic Leak');
  expect(result.importantFactors).toContain('Smoking History');
  let r = (
    await api('PATCH', `/api/results/${result.id}`, {
      version: result.version,
      timePoint: 'In hospital',
      comparison: 'RAMIE vs MIE',
      analysis: 'Propensity-matched (1:1)',
      numericalResult: 'RAMIE 14 (11.7%) vs MIE 22 (18.3%), OR 0.59 (0.29 to 1.21)',
      location: 'Results, p.2; Table 2',
      outcomeDefinition: 'ECCG definition, confirmed by contrast study or endoscopy',
      triage: { answers: { B1: 'Y', B3: 'N' }, notes: {}, evidenceIds: {} }
    })
  ).body;
  expect(r.version).toBe(2);
  let s = (await api('GET', `/api/studies/${study.id}`)).body;
  // Confounder rows were created from the CF matrix for this outcome.
  expect(s.study.data.confounders.map((c: any) => c.factor)).toEqual(expect.arrayContaining(['ASA Physical Status Classification', 'Smoking History']));
  const data = structuredClone(s.study.data);
  data.targetTrial = { ...data.targetTrial, c1: 'Adults with esophageal cancer undergoing esophagectomy 2015–2020', c2: 'RAMIE', c2Type: 'Point', c3: 'Conventional MIE', c3Type: 'Alternative intervention' };
  for (const c of data.confounders) {
    if (['Smoking History', 'Surgeon Experience/Volume', 'Comorbidities', 'Tumor Location'].includes(c.factor)) Object.assign(c, { controlled: 'N', unnecessary: 'N', valid: 'NA' });
    else Object.assign(c, { controlled: 'Y', valid: 'Y', unnecessary: 'NA', variables: c.factor });
  }
  const upd = await api('PATCH', `/api/studies/${study.id}`, { version: s.study.version, data });
  expect(upd.status).toBe(200);
  const appr = await api('POST', `/api/studies/${study.id}/approve`, { note: 'Agreed by both reviewers' });
  expect(appr.status, JSON.stringify(appr.body)).toBe(200);
  s = (await api('GET', `/api/studies/${study.id}`)).body;
  expect(s.study.status).toBe('approved');
  r = s.results[0];
  return { project, study: s.study, result: r };
}

/** Answers every reached question so that each domain reaches a judgement. */
export async function completeAssessment(env: TestEnv, assessmentId: string, reviewer: string, answers: Record<string, string>) {
  let a = (await env.api('GET', `/api/assessments/${assessmentId}`, undefined, reviewer)).body.assessment;
  const responses = Object.fromEntries(Object.entries(answers).map(([q, answer]) => [q, { answer, rationale: `${reviewer} reasoning for ${q}` }]));
  let res = await env.api('PATCH', `/api/assessments/${assessmentId}`, { version: a.version, responses }, reviewer);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  a = res.body;
  const { evaluateAssessment } = await import('@robercop/shared');
  const payload = (await env.api('GET', `/api/assessments/${assessmentId}`, undefined, reviewer)).body;
  const ev = evaluateAssessment(payload.assessment, payload.revision.snapshot, new Map(payload.evidence.map((e: any) => [e.id, e])));
  const domains = Object.fromEntries(Object.entries(ev.domains).map(([d, st]) => [d, { final: st.evaluation.suggested, reason: '' }]));
  res = await env.api('PATCH', `/api/assessments/${assessmentId}`, { version: a.version, domains }, reviewer);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  a = res.body;
  const ev2 = evaluateAssessment(a, payload.revision.snapshot, new Map());
  res = await env.api('PATCH', `/api/assessments/${assessmentId}`, { version: a.version, overall: { final: ev2.overall.suggested, reason: '' } }, reviewer);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

export const ANSWERS_A: Record<string, string> = {
  'Q1.1': 'SN', 'Q1.4': 'N',
  'Q2.1': 'Y', 'Q2.4': 'N', 'Q2.5': 'N',
  'Q3.1': 'Y', 'Q3.2': 'N', 'Q3.3': 'N',
  'Q4.1': 'Y', 'Q4.2': 'Y', 'Q4.3': 'PN', 'Q4.4': 'Y', 'Q4.5': 'PN',
  'Q5.1': 'N', 'Q5.2': 'Y', 'Q5.3': 'WY',
  'Q6.1': 'N', 'Q6.2': 'PN', 'Q6.3': 'NI', 'Q6.4': 'N'
};
