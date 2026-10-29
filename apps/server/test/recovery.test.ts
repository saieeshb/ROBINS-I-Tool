import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createServices } from '../src/services/index.js';
import { newId, now } from '../src/db/database.js';
import { approvedStudy, setup, type TestEnv } from './helpers.js';

const FAKE_CLAUDE = resolve(__dirname, 'fixtures', 'fake-claude.mjs');

const envs: TestEnv[] = [];
afterEach(async () => {
  delete process.env.FAKE_CLAUDE_MODE;
  delete process.env.ANTHROPIC_API_KEY;
  while (envs.length) await envs.pop()!.close();
});

async function assistantEnv() {
  const env = await setup({ claudePath: FAKE_CLAUDE });
  envs.push(env);
  const { result } = await approvedStudy(env, 'independent');
  const a = (await env.api('POST', `/api/results/${result.id}/assessments`, {})).body;
  const draft = (await env.api('PATCH', `/api/assessments/${a.id}`, { version: a.version, responses: { 'Q1.1': { answer: 'SN', rationale: 'My own draft rationale' } } })).body;
  return { env, a: draft };
}

async function runTask(env: TestEnv, a: { id: string; studyId: string }, mode: string) {
  process.env.FAKE_CLAUDE_MODE = mode;
  const run = (await env.api('POST', '/api/ai/runs', { task: 'find_evidence', studyId: a.studyId, assessmentId: a.id, scope: { questionIds: ['Q1.1', 'Q5.2'] } })).body;
  expect(run.id, JSON.stringify(run)).toBeTruthy();
  return run as { id: string };
}

async function waitFor(env: TestEnv, runId: string, done: (status: string) => boolean) {
  for (let i = 0; i < 200; i++) {
    const r = (await env.api('GET', `/api/ai/runs/${runId}`)).body;
    if (done(r.run.status)) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('run did not finish');
}
const finished = (s: string) => !['queued', 'running'].includes(s);

describe('assistant runs through Claude Code', () => {
  it('runs isolated, never sees an API key, and only proposes: nothing is accepted or answered automatically', async () => {
    const { env, a } = await assistantEnv();
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-be-used';
    const run = await runTask(env, a, 'ok');
    const r = await waitFor(env, run.id, finished);
    expect(r.run.status, r.run.error).toBe('succeeded');
    expect(r.proposals.find((p: any) => p.kind === 'evidence').check.status).toBe('matched');
    expect(r.proposals.some((p: any) => p.kind === 'missing_info' && p.target.questionId === 'Q5.2')).toBe(true);
    // Proposals are not evidence and do not touch answers.
    expect(env.services.store.evidence.find({ study_id: a.studyId })).toHaveLength(0);
    const after = (await env.api('GET', `/api/assessments/${a.id}`)).body.assessment;
    expect(after.version).toBe(a.version);
    expect(after.responses['Q5.2']).toBeUndefined();

    const dir = join(env.dataDir, 'runs', run.id);
    const received = JSON.parse(readFileSync(join(dir, 'fake-received.json'), 'utf8'));
    expect(received.hasApiKey).toBe(false);
    expect(received.bare).toBe(false);
    expect(received.args).not.toContain('--bare');
    const args: string[] = received.args;
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args[args.indexOf('--allowedTools') + 1].split(',').every((t) => t.startsWith('mcp__robercop__'))).toBe(true);
    const mcp = JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'));
    expect(Object.keys(mcp.mcpServers)).toEqual(['robercop']);

    // Accepting a proposed quotation creates evidence, but still sets no answer.
    const ev = r.proposals.find((p: any) => p.kind === 'evidence');
    const acc = await env.api('POST', `/api/proposals/${ev.id}/accept`, {});
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(env.services.store.evidence.find({ study_id: a.studyId })).toHaveLength(1);
    const a2 = (await env.api('GET', `/api/assessments/${a.id}`)).body.assessment;
    expect(a2.responses['Q1.1'].answer).toBe('SN');
    expect(a2.responses['Q1.1'].evidenceIds ?? []).toEqual([]);
  });

  it('reports a usage limit, keeps the streamed text and leaves the draft untouched', async () => {
    const { env, a } = await assistantEnv();
    const r = await waitFor(env, (await runTask(env, a, 'limit')).id, finished);
    expect(r.run.status).toBe('usage_limited');
    expect(r.run.error).toMatch(/usage limit was reached\. Your work is saved/);
    expect(r.run.outputText).toMatch(/Looking at the methods/);
    const after = (await env.api('GET', `/api/assessments/${a.id}`)).body.assessment;
    expect(after.responses['Q1.1']).toMatchObject({ answer: 'SN', rationale: 'My own draft rationale' });
    const status = (await env.api('GET', '/api/ai/status')).body;
    expect(status.usage.status).toBe('rejected');
  });

  it('asks the reviewer to sign in again instead of falling back to anything else', async () => {
    const { env, a } = await assistantEnv();
    const r = await waitFor(env, (await runTask(env, a, 'auth')).id, finished);
    expect(r.run.status).toBe('auth_required');
    expect(r.run.error).toMatch(/sign in again\. Your work is saved/);
  });

  it('stops a run that would bill an API key', async () => {
    const { env, a } = await assistantEnv();
    const r = await waitFor(env, (await runTask(env, a, 'apikey')).id, finished);
    expect(r.run.status).toBe('auth_required');
    expect(r.run.error).toMatch(/billed API key/);
  });

  it('imports nothing when the output does not validate', async () => {
    const { env, a } = await assistantEnv();
    const r = await waitFor(env, (await runTask(env, a, 'badjson')).id, finished);
    expect(r.run.status).toBe('failed');
    expect(r.run.error).toMatch(/unexpected format/);
    expect(r.proposals).toHaveLength(0);
  });

  it('cancels a running request and keeps what was streamed so far', async () => {
    const { env, a } = await assistantEnv();
    const run = await runTask(env, a, 'hang');
    await waitFor(env, run.id, (s) => s === 'running');
    await new Promise((res) => setTimeout(res, 300));
    const c = await env.api('POST', `/api/ai/runs/${run.id}/cancel`, {});
    expect(c.body.status).toBe('cancelled');
    expect(c.body.outputText).toMatch(/Partial draft/);
  });

  it('refuses to start when Claude Code is signed out', async () => {
    const { env, a } = await assistantEnv();
    const r = await waitFor(env, (await runTask(env, a, 'loggedout')).id, finished);
    expect(r.run.status).toBe('auth_required');
    expect(r.run.error).toMatch(/not signed in/);
  });
});

describe('recovery after the app stops unexpectedly', () => {
  it('requeues an interrupted parse and marks interrupted assistant runs, keeping all saved work', async () => {
    const env = await setup({ claudePath: FAKE_CLAUDE });
    const { study, result } = await approvedStudy(env, 'independent');
    const a = (await env.api('POST', `/api/results/${result.id}/assessments`, {})).body;
    await env.api('PATCH', `/api/assessments/${a.id}`, { version: a.version, responses: { 'Q1.1': { answer: 'WN', rationale: 'before the crash' } } });
    const store = env.services.store;
    const doc = env.services.documents.forStudy(study.id)[0];
    // Simulate a crash: a parse job and an assistant run left "running", and one parse that keeps failing.
    const base = { documentId: doc.id, parser: 'pdfjs' as const, parserVersion: '', settings: {}, progress: 40, error: null, warnings: [], coverage: null, createdAt: '', startedAt: now(), finishedAt: null, version: 0 };
    const job = store.parseJobs.insert({ ...base, id: newId(), status: 'running', attempts: 1 }, { actor: 'system', reason: 'test' });
    const stuck = store.parseJobs.insert({ ...base, id: newId(), status: 'running', attempts: 3 }, { actor: 'system', reason: 'test' });
    process.env.FAKE_CLAUDE_MODE = 'hang';
    const run = (await env.api('POST', '/api/ai/runs', { task: 'chat', studyId: study.id, assessmentId: a.id, scope: { message: 'hello' } })).body;
    await waitFor(env, run.id, (s) => s === 'running');
    // The app stops while both are in progress; nothing more is written for them.
    await env.app.close();
    env.services.close();

    const restarted = createServices(loadConfig({ dataDir: env.dataDir, pythonPath: null, claudePath: FAKE_CLAUDE }));
    try {
      expect(restarted.parsing.recover()).toBe(2);
      expect(restarted.ai.recover()).toBe(1);
      await restarted.parsing.idle();
      expect(restarted.store.parseJobs.require(job.id)).toMatchObject({ status: 'succeeded', attempts: 2 });
      expect(restarted.store.parseJobs.require(stuck.id)).toMatchObject({ status: 'failed', error: 'Interrupted too many times.' });
      expect(restarted.store.aiRuns.require(run.id).status).toBe('interrupted');
      expect(restarted.store.assessments.require(a.id).responses['Q1.1']).toMatchObject({ answer: 'WN', rationale: 'before the crash' });
      // A failed parse never removes the text the reviewer already had.
      expect(restarted.documents.currentJob(doc.id)?.status).toBe('succeeded');
    } finally {
      restarted.close();
      const { rmSync } = await import('node:fs');
      rmSync(env.dataDir, { recursive: true, force: true });
    }
  });
});
