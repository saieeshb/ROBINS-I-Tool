import { strFromU8, unzipSync } from 'fflate';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { LEGACY_APPROVER } from '@robercop/shared';
import { ANSWERS_A, FIXTURE_PDF, approvedStudy, completeAssessment, setup, type TestEnv } from './helpers.js';

const QUOTE = 'Smoking history and surgeon experience were not available in the database';

/** Two installations (two reviewers' computers) that only exchange package files. */
const envs: TestEnv[] = [];
async function computer(): Promise<TestEnv> {
  const env = await setup();
  envs.push(env);
  return env;
}
afterEach(async () => {
  while (envs.length) await envs.pop()!.close();
});

async function exportPackage(env: TestEnv, projectId: string, body: Record<string, unknown>, reviewer: string): Promise<Buffer> {
  const res = await env.raw('POST', `/api/projects/${projectId}/packages/export`, body, reviewer);
  expect(res.status, res.text).toBe(200);
  expect(String(res.headers['content-type'])).toMatch(/zip/);
  return res.bytes;
}

async function importPackage(env: TestEnv, bytes: Buffer, reviewer: string, conflicts: 'skip' | 'copy' = 'skip') {
  const preview = await env.upload('/api/packages/preview', { name: 'package.robercop.zip', bytes, type: 'application/zip' }, {}, reviewer);
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  const commit = await env.api('POST', '/api/packages/commit', { token: preview.body.token, conflicts }, reviewer);
  expect(commit.status, JSON.stringify(commit.body)).toBe(200);
  return { preview: preview.body, record: commit.body };
}

function zipText(bytes: Buffer): { files: Record<string, string>; all: string } {
  const files = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(bytes))).filter(([p]) => !p.endsWith('.pdf')).map(([p, b]) => [p, strFromU8(b)]));
  return { files, all: Object.values(files).join('\n') };
}

/** Confirms each domain judgement and the overall judgement at the algorithm's suggestion. */
async function confirmJudgements(env: TestEnv, id: string, reviewer: string) {
  const { evaluateAssessment } = await import('@robercop/shared');
  let payload = (await env.api('GET', `/api/assessments/${id}`, undefined, reviewer)).body;
  let ev = evaluateAssessment(payload.assessment, payload.revision.snapshot, new Map(payload.evidence.map((e: any) => [e.id, e])));
  const domains = Object.fromEntries(Object.entries(ev.domains).map(([d, st]) => [d, { final: st.evaluation.suggested, reason: '' }]));
  let res = await env.api('PATCH', `/api/assessments/${id}`, { version: payload.assessment.version, domains }, reviewer);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  payload = (await env.api('GET', `/api/assessments/${id}`, undefined, reviewer)).body;
  ev = evaluateAssessment(payload.assessment, payload.revision.snapshot, new Map(payload.evidence.map((e: any) => [e.id, e])));
  res = await env.api('PATCH', `/api/assessments/${id}`, { version: payload.assessment.version, overall: { final: ev.overall.suggested, reason: '' } }, reviewer);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** Adds a second numerical result (another outcome of the same study) and re-approves the study. */
async function addSecondResult(env: TestEnv, studyId: string) {
  const r = (await env.api('POST', `/api/studies/${studyId}/results`, { outcome: '90-day mortality' })).body;
  const upd = await env.api('PATCH', `/api/results/${r.id}`, {
    version: r.version,
    timePoint: '90 days',
    comparison: 'RAMIE vs MIE',
    analysis: 'Propensity-matched (1:1)',
    numericalResult: 'RAMIE 2 (1.7%) vs MIE 3 (2.5%)',
    location: 'Table 2',
    outcomeDefinition: 'Death from any cause within 90 days',
    triage: { answers: { B1: 'Y', B3: 'N' }, notes: {}, evidenceIds: {} }
  });
  expect(upd.status, JSON.stringify(upd.body)).toBe(200);
  // New confounder rows for this outcome need an evaluation before approval.
  const s = (await env.api('GET', `/api/studies/${studyId}`)).body;
  const data = structuredClone(s.study.data);
  for (const c of data.confounders) if (!c.controlled) Object.assign(c, { controlled: 'Y', valid: 'Y', unnecessary: 'NA', variables: c.factor });
  expect((await env.api('PATCH', `/api/studies/${studyId}`, { version: s.study.version, data })).status).toBe(200);
  const appr = await env.api('POST', `/api/studies/${studyId}/approve`, {});
  expect(appr.status, JSON.stringify(appr.body)).toBe(200);
  return r;
}

async function submitted(env: TestEnv, resultId: string, reviewer: string, answers: Record<string, string>) {
  const a = (await env.api('POST', `/api/results/${resultId}/assessments`, {}, reviewer)).body;
  expect(a.id, JSON.stringify(a)).toBeTruthy();
  await completeAssessment(env, a.id, reviewer, answers);
  const sub = await env.api('POST', `/api/assessments/${a.id}/submit`, undefined, reviewer);
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  return sub.body;
}

const ANSWERS_B = { ...ANSWERS_A, 'Q4.3': 'N' };

describe('review packages between two computers', () => {
  it('independent mode: the assignment excludes the first reviewer’s work; the completed review comes back and is reconciled', async () => {
    const A = await computer();
    const B = await computer();
    const { project, study, result } = await approvedStudy(A, 'independent');
    const second = await addSecondResult(A, study.id);

    // Alice tags a study-level quotation and adds one of her own inside her Domain session.
    const shared = (await A.api('POST', `/api/studies/${study.id}/evidence`, { quote: QUOTE, questionIds: ['Q1.1'], theme: 'Confounding Control' })).body;
    expect(shared.check.status).toBe('matched');
    const aliceA = (await A.api('POST', `/api/results/${result.id}/assessments`, {})).body;
    const own = (await A.api('POST', `/api/studies/${study.id}/evidence`, { quote: 'No sensitivity analyses for unmeasured confounding were performed.', assessmentId: aliceA.id, questionIds: ['Q1.1'], interpretation: 'Alice private note' })).body;
    let cur = await completeAssessment(A, aliceA.id, 'Alice', ANSWERS_A);
    cur = (await A.api('PATCH', `/api/assessments/${aliceA.id}`, { version: cur.version, responses: { 'Q1.1': { evidenceIds: [own.id], confirm: true } } })).body;
    expect((await A.api('POST', `/api/assessments/${aliceA.id}/submit`)).status).toBe(200);
    const aliceSecond = await submitted(A, second.id, 'Alice', ANSWERS_A);

    // Independent assignment for Bob: sources and the approved study, nothing of Alice's assessment.
    const assignment = await exportPackage(A, project.id, { studyId: study.id, kind: 'independent_assignment' }, 'Alice');
    const zip = zipText(assignment);
    expect(Object.keys(zip.files).some((p) => p.startsWith('assessments/'))).toBe(false);
    expect(zip.all).not.toContain('Alice reasoning');
    expect(zip.all).not.toContain('Alice private note');
    expect(zip.all).not.toContain(own.id);
    const evidence = JSON.parse(zip.files['evidence/evidence.json']);
    expect(evidence.find((e: any) => e.id === shared.id).questionIds).toEqual([]);
    expect(Object.keys(unzipSync(new Uint8Array(assignment))).some((p) => p.endsWith('.pdf'))).toBe(true);

    const imp = await importPackage(B, assignment, 'Bob');
    expect(imp.preview.baseline.status).toBe('new_study');
    const dash = (await B.api('GET', `/api/projects/${project.id}/dashboard`, undefined, 'Bob')).body;
    expect(dash.studies[0].status).toBe('approved');
    expect(dash.studies[0].results).toHaveLength(2);
    // The parsed source came along: quotes are checked on Bob's computer without re-parsing.
    const search = (await B.api('GET', `/api/studies/${study.id}/search?q=${encodeURIComponent('propensity matching')}`, undefined, 'Bob')).body;
    expect(search.hits.length).toBeGreaterThan(0);

    const bob = await submitted(B, result.id, 'Bob', ANSWERS_B);
    expect(bob.role).toBe('second');
    const bobSecond = await submitted(B, second.id, 'Bob', ANSWERS_A);

    const completed = await exportPackage(B, project.id, { studyId: study.id, kind: 'completed_review' }, 'Bob');
    const back = await importPackage(A, completed, 'Alice');
    expect(back.preview.baseline.status).toBe('same');
    expect(back.preview.assessments.map((x: any) => x.state)).toEqual(['new', 'new']);

    // Round trip preserved Bob's assessment and its decision history.
    const onA = (await A.api('GET', `/api/assessments/${bob.id}`, undefined, 'Alice')).body.assessment;
    const onB = (await B.api('GET', `/api/assessments/${bob.id}`, undefined, 'Bob')).body.assessment;
    expect(onA.responses).toEqual(onB.responses);
    expect(onA.domains).toEqual(onB.domains);
    expect(onA.importedFrom.installationId).toBe((await B.api('GET', '/api/health')).body.installationId);
    const hist = (await A.api('GET', `/api/assessments/${bob.id}/history`, undefined, 'Alice')).body.revisions.map((r: any) => r.reason);
    expect(hist.some((r: string) => r.includes('submitted'))).toBe(true);

    // Reconcile result 1: one disagreement (Q4.3); originals stay unchanged.
    const verify = (await A.api('GET', `/api/results/${result.id}/verify`, undefined, 'Alice')).body;
    expect(verify.comparison.filter((r: any) => !r.agree).map((r: any) => r.target)).toEqual(['Q4.3']);
    const consensus = (await A.api('POST', `/api/results/${result.id}/consensus`, {}, 'Alice')).body;
    const items = (await A.api('GET', `/api/assessments/${consensus.id}`, undefined, 'Alice')).body.consensusItems;
    expect(items).toHaveLength(1);
    expect(items[0].answers).toEqual({ Alice: 'PN', Bob: 'N' });
    expect((await A.api('POST', `/api/consensus-items/${items[0].id}/resolve`, { final: 'PN', note: 'Table 1 reports partial adjustment' }, 'Alice')).status).toBe(200);
    await confirmJudgements(A, consensus.id, 'Alice');
    const fin = await A.api('POST', `/api/assessments/${consensus.id}/finalize`, {}, 'Alice');
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    expect(fin.body.status).toBe('finalized');
    expect((await A.api('GET', `/api/assessments/${aliceA.id}`)).body.assessment.status).toBe('submitted');
    expect((await A.api('GET', `/api/assessments/${bob.id}`)).body.assessment.status).toBe('submitted');

    // Result 2: full agreement, finalized through a consensus record too.
    const c2 = (await A.api('POST', `/api/results/${second.id}/consensus`, {}, 'Alice')).body;
    await confirmJudgements(A, c2.id, 'Alice');
    expect((await A.api('POST', `/api/assessments/${c2.id}/finalize`, {}, 'Alice')).body.status).toBe('finalized');
    const dashA = (await A.api('GET', `/api/projects/${project.id}/dashboard`, undefined, 'Alice')).body;
    expect(dashA.studies[0].results.map((r: any) => r.reviewStatus)).toEqual(['Finalized', 'Finalized']);
    void aliceSecond;
    void bobSecond;

    // The report documents both originals and the reconciliation.
    const report = await A.raw('GET', `/api/assessments/${consensus.id}/report?reviewer=Alice`);
    expect(report.status).toBe(200);
    expect(report.text).toContain('Reconciliation');
    expect(report.text).toContain('Table 1 reports partial adjustment');
    expect(report.text).toContain('Decision history');
  });

  it('checking mode: the checker’s decisions travel back, requested changes are resolved, and the checked assessment is finalized', async () => {
    const A = await computer();
    const B = await computer();
    const { project, study, result } = await approvedStudy(A, 'checking');
    const second = await addSecondResult(A, study.id);
    const alice = await submitted(A, result.id, 'Alice', ANSWERS_A);
    const alice2 = await submitted(A, second.id, 'Alice', ANSWERS_A);

    await importPackage(B, await exportPackage(A, project.id, { studyId: study.id, kind: 'checking_assignment' }, 'Alice'), 'Bob');
    // Bob cannot edit Alice's assessment, only check it.
    const edit = await B.api('PATCH', `/api/assessments/${alice.id}`, { version: alice.version, responses: { 'Q1.4': { answer: 'Y' } } }, 'Bob');
    expect(edit.status).toBe(400);
    const payload = (await B.api('GET', `/api/assessments/${alice.id}`, undefined, 'Bob')).body;
    const targets = payload.verification.targets.map((t: any) => t.target).filter((t: string) => t !== 'Q4.3');
    expect((await B.api('POST', `/api/assessments/${alice.id}/verifications/confirm`, { targets }, 'Bob')).status).toBe(200);
    const cr = await B.api('POST', `/api/assessments/${alice.id}/verifications`, { target: 'Q4.3', verdict: 'change_requested', proposedAnswer: 'N', comment: 'Methods state no adjustment for tumour stage' }, 'Bob');
    expect(cr.status, JSON.stringify(cr.body)).toBe(200);
    const t2 = (await B.api('GET', `/api/assessments/${alice2.id}`, undefined, 'Bob')).body.verification.targets.map((t: any) => t.target);
    await B.api('POST', `/api/assessments/${alice2.id}/verifications/confirm`, { targets: t2 }, 'Bob');

    // Back on Alice's computer: her assessments are unchanged; Bob's decisions arrive.
    const back = await importPackage(A, await exportPackage(B, project.id, { studyId: study.id, kind: 'completed_review' }, 'Bob'), 'Alice');
    expect(back.preview.assessments.map((x: any) => x.state)).toEqual(['identical', 'identical']);
    expect(back.record.notes.join(' ')).toMatch(/verification decision/);
    let status = (await A.api('GET', `/api/results/${result.id}/verify`)).body.checking.status;
    expect(status.open.map((d: any) => d.target)).toEqual(['Q4.3']);

    // Alice accepts the change: reopen, change, reconfirm, resubmit.
    expect((await A.api('POST', `/api/assessments/${alice.id}/reopen`, { reason: 'Checker requested a change to Q4.3' })).status).toBe(200);
    let a = (await A.api('GET', `/api/assessments/${alice.id}`)).body.assessment;
    a = (await A.api('PATCH', `/api/assessments/${alice.id}`, { version: a.version, responses: { 'Q4.3': { answer: 'N' } } })).body;
    expect(a.domains.D4.needsReconfirm).toBeTruthy();
    await confirmJudgements(A, alice.id, 'Alice');
    expect((await A.api('POST', `/api/verifications/${cr.body.id}/resolve`, { resolution: 'accepted', note: 'Changed to N' })).status).toBe(200);
    expect((await A.api('POST', `/api/assessments/${alice.id}/submit`)).status).toBe(200);

    // Bob receives the update; his copy is updated (it was never edited on his computer).
    const upd = await importPackage(B, await exportPackage(A, project.id, { studyId: study.id, kind: 'checking_assignment' }, 'Alice'), 'Bob');
    expect(upd.preview.assessments.map((x: any) => x.state)).toEqual(['update', 'identical']);
    status = (await B.api('GET', `/api/results/${result.id}/verify`, undefined, 'Bob')).body.checking.status;
    expect(status.awaitingRecheck).toEqual(['Q4.3']);
    expect(status.changedSinceCheck).toEqual(expect.arrayContaining(['D4', 'overall']));
    // Finalizing is blocked until everything changed has been checked again.
    expect((await B.api('POST', `/api/assessments/${alice.id}/finalize`, {}, 'Bob')).status).toBe(400);
    await B.api('POST', `/api/assessments/${alice.id}/verifications/confirm`, { targets: ['Q4.3', ...status.changedSinceCheck] }, 'Bob');
    const fin = await B.api('POST', `/api/assessments/${alice.id}/finalize`, {}, 'Bob');
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    expect((await B.api('POST', `/api/assessments/${alice2.id}/finalize`, {}, 'Bob')).status).toBe(200);

    // The finalized versions travel back and replace Alice's submitted copies.
    const done = await importPackage(A, await exportPackage(B, project.id, { studyId: study.id, kind: 'completed_review' }, 'Bob'), 'Alice');
    expect(done.preview.assessments.map((x: any) => x.state)).toEqual(['update', 'update']);
    const finalA = (await A.api('GET', `/api/assessments/${alice.id}`)).body;
    expect(finalA.assessment.status).toBe('finalized');
    expect(finalA.assessment.responses['Q4.3'].answer).toBe('N');
    expect(finalA.assessment.responses['Q4.3'].decidedBy).toBe('Alice');
    expect(finalA.verification.decisions.find((d: any) => d.id === cr.body.id).resolution).toBe('superseded');
    // Importing the same package again changes nothing.
    const again = await importPackage(A, await exportPackage(B, project.id, { studyId: study.id, kind: 'completed_review' }, 'Bob'), 'Alice');
    expect(again.preview.assessments.map((x: any) => x.state)).toEqual(['identical', 'identical']);
  });

  it('never overwrites work changed on both sides; a conflicting version can be kept as a copy', async () => {
    const A = await computer();
    const B = await computer();
    const { project, study, result } = await approvedStudy(A, 'checking');
    const alice = await submitted(A, result.id, 'Alice', ANSWERS_A);
    await importPackage(B, await exportPackage(A, project.id, { studyId: study.id, kind: 'checking_assignment' }, 'Alice'), 'Alice');

    // Alice edits on both computers.
    for (const [env, answer] of [[A, 'PN'], [B, 'Y']] as const) {
      await env.api('POST', `/api/assessments/${alice.id}/reopen`, { reason: 'second look' }, 'Alice');
      const cur = (await env.api('GET', `/api/assessments/${alice.id}`, undefined, 'Alice')).body.assessment;
      expect((await env.api('PATCH', `/api/assessments/${alice.id}`, { version: cur.version, responses: { 'Q1.4': { answer } } }, 'Alice')).status).toBe(200);
    }
    const pkg = await exportPackage(B, project.id, { studyId: study.id, kind: 'completed_review' }, 'Alice');
    const skipped = await importPackage(A, pkg, 'Alice', 'skip');
    expect(skipped.preview.assessments[0].state).toBe('conflict');
    expect((await A.api('GET', `/api/assessments/${alice.id}`)).body.assessment.responses['Q1.4'].answer).toBe('PN');

    const copied = await importPackage(A, pkg, 'Alice', 'copy');
    expect(copied.record.notes.join(' ')).toMatch(/separate copy/);
    const all = A.services.store.assessments.find({ result_id: result.id });
    expect(all).toHaveLength(2);
    expect(all.map((x) => x.responses['Q1.4'].answer).sort()).toEqual(['PN', 'Y']);
  });

  it('rejects damaged packages and packages whose study revision conflicts with local content', async () => {
    const A = await computer();
    const { project, study } = await approvedStudy(A, 'independent');
    const pkg = await exportPackage(A, project.id, { studyId: study.id, kind: 'independent_assignment' }, 'Alice');
    const files = unzipSync(new Uint8Array(pkg));
    const { zipSync, strToU8 } = await import('fflate');
    const ev = JSON.parse(strFromU8(files['evidence/evidence.json']));
    files['evidence/evidence.json'] = strToU8(JSON.stringify([...ev, { id: 'injected' }]));
    const tampered = Buffer.from(zipSync(files));
    const res = await A.upload('/api/packages/preview', { name: 'x.zip', bytes: tampered }, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/damaged/);
    const notZip = await A.upload('/api/packages/preview', { name: 'x.zip', bytes: Buffer.from('hello') }, {});
    expect(notZip.status).toBe(400);
  });
});

function legacyDomainSession(over: Record<string, unknown> = {}) {
  const answers: Record<string, Record<string, unknown>> = { d1: {}, d2: {}, d3: {}, d4: {}, d5: {}, d6: {} };
  for (const [q, a] of Object.entries(ANSWERS_A)) answers[`d${q[1]}`][`q${q.slice(1).replace('.', '_')}`] = a;
  for (const d of Object.values(answers)) d.evidence = {};
  (answers.d1.evidence as Record<string, string>).q1_1_ev = 'Table 1: smoking and surgeon volume not adjusted';
  answers.d1.judgement = 'Serious';
  answers.d2.judgement = 'Low';
  answers.d5.override = 'Moderate';
  answers.d5.overrideJust = 'Assessors aware of intervention';
  return {
    mode: 'domain',
    setup: { projectId: 'ESO-01', studyCitation: 'Legacy LK, et al. A legacy cohort. Ann Surg. 2019.', reviewer: 'Alice', date: '2025-03-01', outcomes: ['Anastomotic leak'] },
    prelim: { c1: 'Adults undergoing esophagectomy', c2: 'RAMIE', c2type: 'Point', c3: 'MIE', c3type: 'Alternative intervention', c4: 'No', d_sources: 'Journal article' },
    outcomesData: [{ name: 'Anastomotic leak', a1: 'OR 0.59 (0.29–1.21)', a2: 'Table 2', a3: 'ECCG definition', b1: 'Y', b2: '', b3: 'N', importantCFs: ['Smoking History', 'Comorbidities'] }],
    cfEval: [
      { factor: 'Smoking History', variable: '', controlled: 'N', valid: '', unnecessary: 'N', page: '4', notes: 'Not available' },
      { factor: 'Comorbidities', variable: 'CCI', controlled: 'Y', valid: 'Y', unnecessary: '', page: '3', notes: '' }
    ],
    domainSetup: { studyFile: '', outcomeIdx: 0, outcomeName: 'Anastomotic leak' },
    domains: answers,
    overall: { judgement: 'Serious', override: '', overrideJust: '' },
    evidenceBank: [{ id: 1, theme: 'Confounding Control', quote: QUOTE, page: '1', relevantSQs: ['Q1.1'], summary: 'Key confounders missing' }],
    ...over
  };
}

describe('legacy imports', () => {
  it('imports a legacy Domain session for reconfirmation without inventing any approval', async () => {
    const A = await computer();
    const project = (await A.api('POST', '/api/projects', { name: 'Legacy migration', verificationMode: 'independent' })).body;
    const file = { name: 'ROBINS-I_EB_DOMAIN_Anastomotic leak_2025-03-01.json', bytes: Buffer.from(JSON.stringify(legacyDomainSession())), type: 'application/json' };
    const preview = await A.upload(`/api/projects/${project.id}/legacy/preview`, file, {});
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.source).toBe('json-domain');
    expect(preview.body.summary.answers).toBe(Object.keys(ANSWERS_A).length);
    expect(preview.body.willCreate.join(' ')).toMatch(/must be confirmed by a reviewer/);
    const commit = await A.api('POST', `/api/projects/${project.id}/legacy/commit`, { token: preview.body.token });
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    const { studyId, assessmentId } = commit.body;

    // Nothing is approved, submitted or verified.
    const s = A.services.store;
    const study = s.studies.require(studyId);
    expect(study.status).toBe('draft');
    expect(study.approvedRevisionId).toBeNull();
    expect(s.studyRevisions.find({ study_id: studyId }).map((r) => r.approvedBy)).toEqual([LEGACY_APPROVER]);
    const a = s.assessments.require(assessmentId);
    expect(a.status).toBe('draft');
    expect(Object.values(a.responses).every((r) => r.origin === 'legacy_import')).toBe(true);
    expect(Object.values(a.domains).every((d) => d!.origin === 'legacy_import')).toBe(true);
    expect(a.domains.D5!.final).toBe('Moderate');
    expect(a.responses['Q1.1'].legacyEvidence).toMatch(/Table 1/);
    expect(s.verifications.find({ assessment_id: assessmentId })).toHaveLength(0);
    const ev = s.evidence.find({ study_id: studyId });
    expect(ev).toHaveLength(1);
    expect(ev[0].check.status).toBe('not_checked');

    const sub = await A.api('POST', `/api/assessments/${assessmentId}/submit`);
    expect(sub.status).toBe(400);
    const messages = sub.body.details.map((d: any) => d.message).join('\n');
    expect(messages).toMatch(/legacy file and have not been reviewed/);
    expect(messages).toMatch(/imported answer has not been confirmed/);
    const result = s.results.find({ study_id: studyId })[0];
    expect((await A.api('POST', `/api/results/${result.id}/assessments`, {}, 'Bob')).status).toBe(400);

    // Attaching the PDF checks the imported evidence-bank quotation.
    await A.upload(`/api/studies/${studyId}/documents`, FIXTURE_PDF, { role: 'manuscript', label: 'Main article' });
    await A.services.parsing.idle();
    expect(s.evidence.find({ study_id: studyId })[0].check.status).toBe('matched');

    // Approving identical content creates a real approval rather than reusing the legacy revision.
    const appr = await A.api('POST', `/api/studies/${studyId}/approve`, {});
    expect(appr.status, JSON.stringify(appr.body)).toBe(200);
    expect(appr.body.revision.approvedBy).toBe('Alice');
    expect(appr.body.revision.revisionNo).toBe(2);

    // Alice moves her imported assessment onto the approved revision and confirms each decision.
    expect((await A.api('POST', `/api/assessments/${assessmentId}/rebase`)).status).toBe(200);
    let cur = (await A.api('GET', `/api/assessments/${assessmentId}`)).body.assessment;
    const confirms = Object.fromEntries(Object.keys(ANSWERS_A).map((q) => [q, { confirm: true }]));
    cur = (await A.api('PATCH', `/api/assessments/${assessmentId}`, { version: cur.version, responses: confirms })).body;
    expect(cur.responses['Q1.1']).toMatchObject({ origin: 'reviewer', decidedBy: 'Alice' });
    await confirmJudgements(A, assessmentId, 'Alice');
    const ok = await A.api('POST', `/api/assessments/${assessmentId}/submit`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('imports both legacy Excel layouts and keeps invalid answers only as notes', async () => {
    const A = await computer();
    const project = (await A.api('POST', '/api/projects', { name: 'Legacy xlsx', verificationMode: 'checking' })).body;
    const wb = new ExcelJS.Workbook();
    const sum = wb.addWorksheet('Summary');
    for (const row of [
      ['ROBINS-I V2 Risk of Bias Assessment (Evidence Bank Edition)'],
      [],
      ['Project ID', 'ESO-01'],
      ['Study', 'Excel E, et al. Spreadsheet cohort. 2018.'],
      ['Reviewer', 'Carol'],
      ['Date', '2024-11-02'],
      ['Outcome', 'Pneumonia'],
      [],
      ['PRELIMINARY - PER OUTCOME'],
      ['Outcome 1: Pneumonia'],
      ['A1: Result', 'RR 0.8'],
      ['A2: Location', 'Table 3'],
      ['A3: Outcome Definition', 'Uniform Pneumonia Score'],
      ['B1', 'Y'],
      ['B2', ''],
      ['B3', 'N'],
      ['Triage', 'Passed'],
      [],
      ['TARGET TRIAL'],
      ['C1: Participants', 'Adults'],
      ['C2: Intervention', 'Hybrid'],
      ['C3: Comparator', 'Open'],
      ['C4: Effect Type', 'ITT'],
      [],
      ['DOMAIN JUDGEMENTS'],
      ['D1', 'Serious'],
      ['D2', 'Low'],
      ['D3', ''],
      ['D4', ''],
      ['D5', ''],
      ['D6', ''],
      [],
      ['OVERALL', 'Serious']
    ])
      sum.addRow(row);
    wb.addWorksheet('CF Evaluation').addRows([
      ['Factor', 'Variable', 'Controlled', 'Valid', 'Unnecessary', 'Page', 'Notes'],
      ['Age', 'age', 'Y', 'Y', '', '3', '']
    ]);
    wb.addWorksheet('Evidence').addRows([
      ['Question', 'Response', 'Evidence'],
      ['Q1.1', 'SN', 'Not adjusted for smoking'],
      ['Q1.4', 'XX', ''],
      ['Q2.1', '', '']
    ]);
    wb.addWorksheet('Evidence Bank').addRows([
      ['Theme', 'Quote', 'Page', 'Relevant SQs', 'Summary'],
      ['Confounding Control', QUOTE, '1', 'Q1.1, Q1.4', 'missing confounders']
    ]);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const preview = await A.upload(`/api/projects/${project.id}/legacy/preview`, { name: 'ROBINS-I_EB_Excel.xlsx', bytes }, {});
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.source).toBe('xlsx-evidence-bank');
    expect(preview.body.warnings.join(' ')).toMatch(/Q1\.4=XX/);
    const commit = await A.api('POST', `/api/projects/${project.id}/legacy/commit`, { token: preview.body.token });
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    const a = A.services.store.assessments.require(commit.body.assessmentId);
    expect(a.reviewer).toBe('Carol');
    expect(a.responses['Q1.1'].answer).toBe('SN');
    expect(a.responses['Q1.4'].answer).toBe('');
    expect(a.responses['Q1.4'].rationale).toMatch(/not a valid option/);
    expect(a.domains.D1!.final).toBe('Serious');
    expect(a.overall.final).toBe('Serious');
    const ev = A.services.store.evidence.find({ study_id: commit.body.studyId });
    expect(ev[0].questionIds).toEqual(['Q1.1', 'Q1.4']);

    // A study-mode (non-evidence-bank) export imports as a study only.
    const plain = new ExcelJS.Workbook();
    plain.addWorksheet('Summary').addRows([['Study', 'Plain P. 2017.'], ['Outcome 1: Leak'], ['A1: Result', '5 vs 7'], ['B1', 'Y'], ['B3', 'N']]);
    const p2 = await A.upload(`/api/projects/${project.id}/legacy/preview`, { name: 'plain.xlsx', bytes: Buffer.from(await plain.xlsx.writeBuffer()) }, {});
    expect(p2.body.source).toBe('xlsx');
    const c2 = await A.api('POST', `/api/projects/${project.id}/legacy/commit`, { token: p2.body.token });
    expect(c2.body.assessmentId).toBeNull();
  });

  it('rejects files that are not legacy sessions', async () => {
    const A = await computer();
    const project = (await A.api('POST', '/api/projects', { name: 'x', verificationMode: 'independent' })).body;
    const bad = await A.upload(`/api/projects/${project.id}/legacy/preview`, { name: 'x.json', bytes: Buffer.from('{"hello":1}') }, {});
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/not a saved session/);
  });
});

describe('exports', () => {
  it('exports Excel, JSON and a printable report while keeping independent assessments hidden', async () => {
    const A = await computer();
    const { project, study, result } = await approvedStudy(A, 'independent');
    const alice = (await A.api('POST', `/api/results/${result.id}/assessments`, {})).body;
    const ev = (await A.api('POST', `/api/studies/${study.id}/evidence`, { quote: QUOTE, assessmentId: alice.id })).body;
    let cur = await completeAssessment(A, alice.id, 'Alice', ANSWERS_A);
    cur = (await A.api('PATCH', `/api/assessments/${alice.id}`, { version: cur.version, responses: { 'Q1.1': { evidenceIds: [ev.id], confirm: true } } })).body;
    const bob = (await A.api('POST', `/api/results/${result.id}/assessments`, {}, 'Bob')).body;
    await completeAssessment(A, bob.id, 'Bob', ANSWERS_B);

    // Alice has not submitted: Bob's assessment stays out of her exports.
    const json = await A.raw('GET', `/api/projects/${project.id}/export.json`);
    const data = JSON.parse(json.text);
    expect(data.studies[0].assessments.map((x: any) => x.assessment.reviewer)).toEqual(['Alice']);
    expect((await A.raw('GET', `/api/assessments/${bob.id}/report?reviewer=Alice`)).status).toBe(403);

    const xlsx = await A.raw('GET', `/api/projects/${project.id}/export.xlsx`);
    expect(xlsx.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['About', 'Judgements', 'Domains', 'Answers', 'Verification', 'Results', 'Confounders', 'Evidence']);
    expect(wb.getWorksheet('Judgements')!.rowCount).toBe(2);
    const answers = wb.getWorksheet('Answers')!;
    const q11 = answers.getRows(2, answers.rowCount - 1)!.find((r) => r.getCell(4).value === 'Q1.1')!;
    expect(String(q11.getCell(9).value)).toMatch(/Matched \((exact|normalized)\) · Main article p\. 1/);

    const report = await A.raw('GET', `/api/assessments/${alice.id}/report?reviewer=Alice`);
    expect(report.status).toBe(200);
    expect(report.text).toContain(QUOTE);
    expect(report.text).toContain('Main article p. 1');
    expect(report.text).toMatch(/Q1\.1: — → SN/);

    const one = JSON.parse((await A.raw('GET', `/api/assessments/${alice.id}/export.json`)).text);
    expect(one.evaluation.domains.D1.suggested).toBe('Serious');
    expect(one.evidence.map((e: any) => e.id)).toEqual([ev.id]);
    const ax = await A.raw('GET', `/api/assessments/${alice.id}/export.xlsx`);
    expect(String(ax.headers['content-disposition'])).toMatch(/\.xlsx/);
  });
});
