import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANSWERS_A, approvedStudy, completeAssessment, setup, type TestEnv } from './helpers.js';

describe('study and domain sessions', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => env.close());

  it('parses an attached PDF once with the built-in parser and records coverage', async () => {
    const { study } = await approvedStudy(env, 'checking');
    const s = (await env.api('GET', `/api/studies/${study.id}`)).body;
    const doc = s.documents[0];
    expect(doc.job.status).toBe('succeeded');
    expect(doc.job.parser).toBe('pdfjs');
    expect(doc.job.coverage.pages).toBe(2);
    expect(doc.job.coverage.emptyPages).toEqual([]);
    const search = (await env.api('GET', `/api/studies/${study.id}/search?q=${encodeURIComponent('propensity matching')}`)).body;
    expect(search.hits.length).toBeGreaterThan(0);
    expect(search.hits[0].page).toBe(1);
  });

  it('refuses approval until the study is complete, and reports what is missing', async () => {
    const project = (await env.api('POST', '/api/projects', { name: 'Draft project', verificationMode: 'independent' })).body;
    const study = (await env.api('POST', `/api/projects/${project.id}/studies`, { label: 'Incomplete 2020' })).body;
    const res = await env.api('POST', `/api/studies/${study.id}/approve`, {});
    expect(res.status).toBe(400);
    expect(res.body.details.map((d: any) => d.target)).toEqual(expect.arrayContaining(['citation', 'c1', 'results']));
  });

  it('runs a Domain session from the approved study without any file transfer', async () => {
    const { result } = await approvedStudy(env, 'checking');
    const created = await env.api('POST', `/api/results/${result.id}/assessments`, {});
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const a = created.body;
    expect(a.role).toBe('first');
    const payload = (await env.api('GET', `/api/assessments/${a.id}`)).body;
    expect(payload.revision.snapshot.results[0].numericalResult).toMatch(/RAMIE 14/);
    expect(payload.canEdit).toBe(true);

    // Evidence: an exact quotation from the PDF is matched with page and block.
    const ev = await env.api('POST', `/api/studies/${a.studyId}/evidence`, {
      quote: 'Smoking history and surgeon experience were not available in the database',
      assessmentId: a.id,
      questionIds: ['Q1.1']
    });
    expect(ev.status).toBe(200);
    expect(ev.body.check.status).toBe('matched');
    expect(ev.body.page).toBe(1);
    // A quotation spanning a line-break hyphenation matches after normalization.
    const ev2 = (await env.api('POST', `/api/studies/${a.studyId}/evidence`, { quote: 'No sensitivity analyses for unmeasured confounding were performed.', assessmentId: a.id })).body;
    expect(ev2.check.status).toBe('matched');
    expect(ev2.check.method).toBe('normalized');
    // A paraphrase is not accepted as a match.
    const ev3 = (await env.api('POST', `/api/studies/${a.studyId}/evidence`, { quote: 'Smoking data were unavailable in the registry', assessmentId: a.id })).body;
    expect(ev3.check.status).toBe('unmatched');

    // Linking an unverified quotation blocks submission until resolved.
    let cur = (await env.api('PATCH', `/api/assessments/${a.id}`, { version: a.version, responses: { 'Q1.1': { answer: 'SN', evidenceIds: [ev.body.id, ev3.id] } } })).body;
    cur = await completeAssessment(env, a.id, 'Alice', ANSWERS_A);
    let sub = await env.api('POST', `/api/assessments/${a.id}/submit`);
    expect(sub.status).toBe(400);
    expect(JSON.stringify(sub.body.details)).toMatch(/quotation is unmatched/);
    // Manual check documented by the reviewer resolves it.
    const mc = await env.api('POST', `/api/evidence/${ev3.id}/manual-check`, { page: 1, note: 'Paraphrase of the methods paragraph; checked in the PDF' });
    expect(mc.body.check.status).toBe('manually_verified');
    // Evidence changed after the answer: reconfirm.
    sub = await env.api('POST', `/api/assessments/${a.id}/submit`);
    expect(JSON.stringify(sub.body.details)).toMatch(/changed after the answer/);
    cur = (await env.api('GET', `/api/assessments/${a.id}`)).body.assessment;
    cur = (await env.api('PATCH', `/api/assessments/${a.id}`, { version: cur.version, responses: { 'Q1.1': { confirm: true } } })).body;
    sub = await env.api('POST', `/api/assessments/${a.id}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.status).toBe('submitted');
    expect(sub.body.domains.D1.final).toBe('Serious');
    expect(sub.body.overall.final).toBe('Serious');
  });

  it('invalidates a confirmed judgement when an answer in that domain changes and excludes unreachable answers', async () => {
    const { result } = await approvedStudy(env, 'independent');
    const a = (await env.api('POST', `/api/results/${result.id}/assessments`, {})).body;
    const done = await completeAssessment(env, a.id, 'Alice', ANSWERS_A);
    expect(done.domains.D2.final).toBe('Low');
    const changed = (await env.api('PATCH', `/api/assessments/${a.id}`, { version: done.version, responses: { 'Q2.1': { answer: 'N' } } })).body;
    expect(changed.domains.D2.needsReconfirm).toMatch(/changed/);
    expect(changed.overall.needsReconfirm).toBeTruthy();
    const payload = (await env.api('GET', `/api/assessments/${a.id}`)).body;
    const { evaluateAssessment } = await import('@robercop/shared');
    const ev = evaluateAssessment(payload.assessment, payload.revision.snapshot, new Map());
    expect(ev.domains.D2.evaluation.needs).toBe('Q2.2');
  });

  it('rejects stale writes (optimistic concurrency) and unknown answers', async () => {
    const { result } = await approvedStudy(env, 'independent');
    const a = (await env.api('POST', `/api/results/${result.id}/assessments`, {})).body;
    const ok = await env.api('PATCH', `/api/assessments/${a.id}`, { version: a.version, responses: { 'Q1.1': { answer: 'Y' } } });
    expect(ok.status).toBe(200);
    const stale = await env.api('PATCH', `/api/assessments/${a.id}`, { version: a.version, responses: { 'Q1.1': { answer: 'PY' } } });
    expect(stale.status).toBe(409);
    expect(stale.body.current.version).toBe(ok.body.version);
    const bad = await env.api('PATCH', `/api/assessments/${a.id}`, { version: ok.body.version, responses: { 'Q2.3': { answer: 'Y' } } });
    expect(bad.status).toBe(400);
  });

  it('requires a justification for overriding the suggested judgement', async () => {
    const { result } = await approvedStudy(env, 'independent');
    const a = (await env.api('POST', `/api/results/${result.id}/assessments`, {})).body;
    const cur = (await env.api('PATCH', `/api/assessments/${a.id}`, { version: a.version, responses: { 'Q5.1': { answer: 'N' }, 'Q5.2': { answer: 'N' } } })).body;
    const noReason = await env.api('PATCH', `/api/assessments/${a.id}`, { version: cur.version, domains: { D5: { final: 'Moderate' } } });
    expect(noReason.status).toBe(400);
    const withReason = await env.api('PATCH', `/api/assessments/${a.id}`, { version: cur.version, domains: { D5: { final: 'Moderate', reason: 'Leak diagnosis involves clinical judgement' } } });
    expect(withReason.status).toBe(200);
    expect(withReason.body.domains.D5).toMatchObject({ final: 'Moderate', suggestedAtDecision: 'Low', decidedBy: 'Alice' });
  });

  it('blocks per-protocol results instead of assessing them as ITT', async () => {
    const { result, study } = await approvedStudy(env, 'independent');
    const s = (await env.api('GET', `/api/studies/${study.id}`)).body;
    const r = (await env.api('PATCH', `/api/results/${result.id}`, { version: s.results[0].version, effect: 'per-protocol' })).body;
    expect(r.effect).toBe('per-protocol');
    await env.api('POST', `/api/studies/${study.id}/approve`, {});
    const res = await env.api('POST', `/api/results/${result.id}/assessments`, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/per-protocol/);
  });

  it('keeps revision history with coalesced autosaves and milestones', async () => {
    const { result } = await approvedStudy(env, 'independent');
    const a = (await env.api('POST', `/api/results/${result.id}/assessments`, {})).body;
    let v = a.version;
    for (const ans of ['Y', 'PY', 'WN']) v = (await env.api('PATCH', `/api/assessments/${a.id}`, { version: v, responses: { 'Q1.1': { answer: ans } } })).body.version;
    const hist = (await env.api('GET', `/api/assessments/${a.id}/history`)).body;
    expect(hist.revisions.map((r: any) => r.reason)).toEqual(['created', 'autosave']);
    expect(hist.revisions[1].version).toBe(v);
  });
});
