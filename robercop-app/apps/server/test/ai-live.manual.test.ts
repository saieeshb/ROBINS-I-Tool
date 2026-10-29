import { it, expect } from 'vitest';
import { approvedStudy, setup } from './helpers.js';

it('runs a live find_evidence task through Claude Code', async () => {
  const env = await setup();
  const { result } = await approvedStudy(env, 'independent');
  const a = (await env.api('POST', `/api/results/${result.id}/assessments`, {})).body;
  const st = (await env.api('GET', '/api/ai/status?refresh=1')).body;
  console.log('STATUS', JSON.stringify(st.assistant));
  const run = (await env.api('POST', '/api/ai/runs', { task: 'find_evidence', studyId: a.studyId, assessmentId: a.id, scope: { questionIds: ['Q1.1', 'Q5.2'] } })).body;
  console.log('RUN', run.id, run.status, run.error);
  const events: string[] = [];
  env.services.ai.subscribe(run.id, (e) => events.push(e.type === 'text' ? 'text' : JSON.stringify(e).slice(0, 200)));
  for (let i = 0; i < 300; i++) {
    const r = (await env.api('GET', `/api/ai/runs/${run.id}`)).body;
    if (!['queued', 'running'].includes(r.run.status)) {
      console.log('FINAL', r.run.status, r.run.error, r.run.costUsd, r.run.model);
      for (const p of r.proposals) console.log('PROPOSAL', p.kind, p.target.questionId, p.check?.status, p.check?.method, JSON.stringify(p.content).slice(0, 220));
      console.log('EVENTS', [...new Set(events)].slice(0, 30).join('\n'));
      const searches = (await env.api('GET', `/api/studies/${a.studyId}/searches?assessmentId=${a.id}`)).body;
      console.log('SEARCHES', JSON.stringify(searches.map((s: any) => [s.query, s.hits])));
      console.log('DIR', env.dataDir);
      expect(r.run.status).toBe('succeeded');
      return;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error('timeout');
}, 400000);
