import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getQuestion } from '@robercop/rules';
import type { AiProposal, AiRun, AiRunStatus, AiTask, ProposalKind, SourceCheck } from '@robercop/shared';
import { checkQuote } from '@robercop/shared';
import { ValidationError, newId, now } from '../db/database.js';
import type { Store } from '../db/store.js';
import type { AppConfig } from '../config.js';
import type { AssessmentService } from '../services/assessments.js';
import type { DocumentService, SourceBundle } from '../services/documents.js';
import type { EvidenceService } from '../services/evidence.js';
import type { StudyService } from '../services/studies.js';
import { childEnv, classifyFailure, ClaudeCli, type ClaudeStatus } from './claude.js';
import { buildPrompt, type TaskContext, type TaskScope } from './context.js';
import { SCHEMAS, systemPrompt, TASK_LABELS } from './prompts.js';
import { extractJson, OUTPUT, type QuoteItem } from './validate.js';

export interface AiTaskRequest {
  task: AiTask;
  studyId: string;
  assessmentId?: string | null;
  scope?: TaskScope;
}

export type RunEvent =
  | { type: 'status'; status: AiRunStatus; message?: string }
  | { type: 'text'; delta: string }
  | { type: 'activity'; label: string }
  | { type: 'usage'; info: Record<string, unknown> }
  | { type: 'done'; run: AiRun; proposals: AiProposal[] };

export interface AiSettings {
  model: string;
  isolateSettings: boolean;
  allowApiBilling: boolean;
}

/** Replaceable assistant connection. Application commands never depend on which runner is used. */
export interface AiRunner {
  readonly name: string;
  status(refresh?: boolean): Promise<ClaudeStatus>;
  start(req: AiTaskRequest, actor: string): Promise<AiRun>;
  cancel(runId: string, actor: string): void;
  subscribe(runId: string, fn: (e: RunEvent) => void): () => void;
}

export const MCP_TOOLS = ['list_sources', 'search_source', 'get_page', 'get_blocks', 'check_quote'];
/** Built-in tools denied when the CLI lacks --tools (older versions). */
const DENY_BUILTINS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'KillShell', 'BashOutput'];
const MAX_CONCURRENT = 2;
const SYSTEM = { actor: 'system', reason: 'assistant run' };

interface Live {
  child: ChildProcess | null;
  listeners: Set<(e: RunEvent) => void>;
  text: string;
  cancelled: boolean;
}

export class ClaudeCodeRunner implements AiRunner {
  readonly name = 'Claude Code';
  readonly cli: ClaudeCli;
  private live = new Map<string, Live>();
  private queue: string[] = [];
  private active = 0;
  private closed = false;
  lastUsage: Record<string, unknown> | null = null;

  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly documents: DocumentService,
    private readonly studies: StudyService,
    private readonly assessments: AssessmentService,
    private readonly evidence: EvidenceService,
    private readonly settings: () => AiSettings
  ) {
    this.cli = new ClaudeCli(config.claudePath);
  }

  status(refresh = false): Promise<ClaudeStatus> {
    return this.cli.status(refresh);
  }

  /** Runs left running or queued when the app stopped are marked interrupted; their partial output is kept. */
  recover(): number {
    let n = 0;
    for (const status of ['running', 'queued'] as const) {
      for (const run of this.store.aiRuns.find({ status })) {
        this.store.aiRuns.mutate(run.id, (r) => void ((r.status = 'interrupted'), (r.error = 'The app stopped while this run was in progress.'), (r.finishedAt = now())), {
          actor: 'system',
          reason: 'recovered after restart'
        });
        n++;
      }
    }
    return n;
  }

  subscribe(runId: string, fn: (e: RunEvent) => void): () => void {
    const live = this.live.get(runId);
    if (!live) return () => {};
    live.listeners.add(fn);
    if (live.text) fn({ type: 'text', delta: live.text });
    return () => live.listeners.delete(fn);
  }

  private emit(runId: string, e: RunEvent): void {
    for (const fn of this.live.get(runId)?.listeners ?? []) fn(e);
  }

  /** Resolves the fixed context a task runs against. */
  buildContext(req: AiTaskRequest): TaskContext {
    const study = this.store.studies.require(req.studyId);
    const scope = req.scope ?? {};
    let snapshot = this.studies.snapshot(study);
    let contextRevision = `study:${study.id}@v${study.version}`;
    let assessment;
    let result;
    if (req.assessmentId) {
      assessment = this.store.assessments.require(req.assessmentId);
      if (assessment.studyId !== study.id) throw new ValidationError('Assessment and study do not match.');
      const revision = this.studies.revision(assessment.studyRevisionId);
      snapshot = revision.snapshot;
      contextRevision = `revision:${revision.id}#${revision.revisionNo}/assessment:${assessment.id}@v${assessment.version}`;
      result = snapshot.results.find((r) => r.id === assessment!.resultId);
    } else if (scope.resultId) {
      result = snapshot.results.find((r) => r.id === scope.resultId);
    }
    const bundle = this.documents.bundle(study.id, { includeReferences: true });
    const markdown = bundle.documents
      .filter((d) => d.job)
      .map((d) => ({ documentId: d.document.id, label: d.document.label, role: d.document.role, text: this.documents.markdown(d.document) }));
    const evidence = this.evidence.visible(study.id, req.assessmentId ?? null);
    return { task: req.task, scope, studyLabel: study.label, snapshot, contextRevision, result, assessment, evidence, bundle, markdown };
  }

  async start(req: AiTaskRequest, actor: string): Promise<AiRun> {
    if (!TASK_LABELS[req.task]) throw new ValidationError(`Unknown assistant task "${req.task}".`);
    const ctx = this.buildContext(req);
    if (ctx.assessment && ctx.assessment.reviewer !== actor && ctx.assessment.role !== 'consensus') {
      throw new ValidationError('Assistant runs inside an assessment are available only to its reviewer.');
    }
    const prompt = buildPrompt(ctx);
    const study = this.store.studies.require(req.studyId);
    const run = this.store.aiRuns.insert(
      {
        id: newId(),
        projectId: study.projectId,
        studyId: study.id,
        assessmentId: req.assessmentId ?? null,
        task: req.task,
        scope: { ...ctx.scope, history: undefined },
        contextRevision: ctx.contextRevision,
        status: 'queued',
        model: null,
        promptSummary: `${TASK_LABELS[req.task]}${ctx.scope.questionIds?.length ? ` · ${ctx.scope.questionIds.join(', ')}` : ''}${ctx.scope.domain ? ` · ${ctx.scope.domain}` : ''}`,
        outputText: '',
        structured: null,
        error: null,
        costUsd: null,
        cliVersion: null,
        createdBy: actor,
        createdAt: '',
        startedAt: null,
        finishedAt: null,
        version: 0
      },
      { actor, reason: 'assistant run queued' }
    );
    const dir = join(this.config.runsDir, run.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prompt.txt'), prompt);
    writeFileSync(join(dir, 'context.json'), JSON.stringify({ bundleJobs: ctx.bundle.jobIds, documents: ctx.bundle.documents.map((d) => ({ id: d.document.id, label: d.document.label, role: d.document.role, jobId: d.job?.id ?? null })) }));
    this.live.set(run.id, { child: null, listeners: new Set(), text: '', cancelled: false });
    this.queue.push(run.id);
    this.pump();
    return run;
  }

  /** Stops running children without recording anything; recover() marks their runs interrupted on the next start. */
  shutdown(): void {
    this.closed = true;
    this.queue = [];
    for (const live of this.live.values()) if (live.child?.pid) killTree(live.child);
  }

  private pump(): void {
    while (!this.closed && this.active < MAX_CONCURRENT && this.queue.length) {
      const id = this.queue.shift()!;
      this.active++;
      void this.execute(id).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  cancel(runId: string, actor: string): void {
    const run = this.store.aiRuns.require(runId);
    const live = this.live.get(runId);
    if (live) {
      live.cancelled = true;
      if (live.child?.pid) killTree(live.child);
    }
    this.queue = this.queue.filter((q) => q !== runId);
    if (run.status === 'queued' || run.status === 'running') {
      this.store.aiRuns.mutate(runId, (r) => void ((r.status = 'cancelled'), (r.finishedAt = now()), (r.outputText = live?.text ?? r.outputText)), { actor, reason: 'cancelled' });
      this.emit(runId, { type: 'status', status: 'cancelled' });
      this.finish(runId);
    }
  }

  private finish(runId: string): void {
    const run = this.store.aiRuns.get(runId);
    if (run) this.emit(runId, { type: 'done', run, proposals: this.store.proposals.find({ run_id: runId }) });
    setTimeout(() => this.live.delete(runId), 30_000);
  }

  private fail(runId: string, status: AiRunStatus, message: string, text = ''): void {
    this.store.aiRuns.mutate(runId, (r) => void ((r.status = status), (r.error = message), (r.finishedAt = now()), (r.outputText = text || r.outputText)), SYSTEM);
    this.emit(runId, { type: 'status', status, message });
    this.finish(runId);
  }

  private async execute(runId: string): Promise<void> {
    const live = this.live.get(runId)!;
    if (live.cancelled || this.closed) return;
    const run = this.store.aiRuns.require(runId);
    const dir = join(this.config.runsDir, runId);
    const settings = this.settings();
    const status = await this.cli.status();
    if (this.closed) return;
    if (!status.installed) return this.fail(runId, 'failed', status.problems[0] ?? 'Claude Code is not installed.');
    if (status.loggedIn === false) return this.fail(runId, 'auth_required', 'Claude Code is not signed in. Run "claude" in a terminal and sign in, then retry.');
    if ((status.usesApiKey || (status.apiProvider && status.apiProvider !== 'firstParty')) && !settings.allowApiBilling) {
      return this.fail(runId, 'auth_required', 'Claude Code is configured for billed API access. Sign in with your Claude subscription, or allow API billing in Settings.');
    }
    const caps = status.capabilities;
    const context = JSON.parse(readFileSync(join(dir, 'context.json'), 'utf8')) as { documents: { id: string; label: string; role: string; jobId: string | null }[] };
    const searchLog = join(dir, 'searches.jsonl');
    const mcpConfig = {
      mcpServers: {
        robercop: {
          type: 'stdio',
          command: this.config.mcpCommand.command,
          args: this.config.mcpCommand.args,
          env: {
            ROBERCOP_DB: this.config.dbPath,
            ROBERCOP_DOCUMENTS: JSON.stringify(context.documents.filter((d) => d.jobId).map((d) => ({ documentId: d.id, jobId: d.jobId, label: d.label, role: d.role }))),
            ROBERCOP_SEARCH_LOG: searchLog
          }
        }
      }
    };
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify(mcpConfig, null, 2));
    const system = systemPrompt();
    writeFileSync(join(dir, 'system.md'), system);
    let prompt = readFileSync(join(dir, 'prompt.txt'), 'utf8');
    const schema = SCHEMAS[run.task];

    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (caps.includePartialMessages) args.push('--include-partial-messages');
    if (caps.tools) args.push('--tools', '');
    else args.push('--disallowedTools', DENY_BUILTINS.join(','));
    args.push('--mcp-config', join(dir, 'mcp.json'));
    if (caps.strictMcpConfig) args.push('--strict-mcp-config');
    args.push('--allowedTools', MCP_TOOLS.map((t) => `mcp__robercop__${t}`).join(','));
    args.push('--permission-mode', 'dontAsk');
    if (caps.permissionPrompts) args.push('--permission-prompts', 'none');
    if (caps.noSessionPersistence) args.push('--no-session-persistence');
    if (caps.disableSlashCommands) args.push('--disable-slash-commands');
    if (settings.isolateSettings && caps.settingSources) args.push('--setting-sources', 'project');
    if (caps.systemPromptFile) args.push('--system-prompt-file', join(dir, 'system.md'));
    else prompt = `${system}\n\n${prompt}`;
    if (schema && caps.jsonSchema) args.push('--json-schema', JSON.stringify(schema));
    else if (schema) prompt += `\n\nReturn ONLY a JSON object matching this JSON Schema, in a \`\`\`json block:\n${JSON.stringify(schema)}`;
    if (settings.model) args.push('--model', settings.model);
    writeFileSync(join(dir, 'args.json'), JSON.stringify(args));

    this.store.aiRuns.mutate(runId, (r) => void ((r.status = 'running'), (r.startedAt = now()), (r.cliVersion = status.version)), SYSTEM);
    this.emit(runId, { type: 'status', status: 'running' });

    let child: ChildProcess;
    try {
      child = await this.cli.spawn(args, { cwd: dir, env: childEnv(settings.allowApiBilling) });
    } catch (err) {
      return this.fail(runId, 'failed', `Could not start Claude Code: ${(err as Error).message}`);
    }
    live.child = child;
    child.stdin!.end(prompt);

    let buffer = '';
    let stderr = '';
    let resultEvent: Record<string, unknown> | null = null;
    let rejectedByLimit = false;
    let model: string | null = null;
    let apiKeySource: string | null = null;
    const rawLog = join(dir, 'stream.jsonl');

    const handle = (line: string) => {
      appendFileSync(rawLog, line + '\n');
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      switch (ev.type) {
        case 'system':
          if (ev.subtype === 'init') {
            model = (ev.model as string) ?? null;
            apiKeySource = (ev.apiKeySource as string) ?? null;
            if (apiKeySource && apiKeySource !== 'none' && !settings.allowApiBilling) {
              killTree(child);
              rejectedByLimit = false;
              resultEvent = { is_error: true, result: `Claude Code is using a billed API key (${apiKeySource}); stopped.`, _billing: true };
            }
          }
          break;
        case 'stream_event': {
          const se = ev.event as Record<string, unknown>;
          if (se?.type === 'content_block_delta') {
            const delta = se.delta as Record<string, unknown>;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              live.text += delta.text;
              this.emit(runId, { type: 'text', delta: delta.text });
            }
          } else if (se?.type === 'content_block_start') {
            const block = se.content_block as Record<string, unknown>;
            if (block?.type === 'tool_use') {
              const name = String(block.name ?? '');
              this.emit(runId, { type: 'activity', label: name === 'StructuredOutput' ? 'Writing structured results…' : `Using ${name.replace('mcp__robercop__', '').replace(/_/g, ' ')}` });
            }
          }
          break;
        }
        case 'assistant': {
          const content = ((ev.message as Record<string, unknown>)?.content ?? []) as Record<string, unknown>[];
          for (const c of content) {
            if (c.type === 'tool_use' && String(c.name).startsWith('mcp__robercop__')) {
              const input = c.input as Record<string, unknown>;
              const label = input?.query ? `Searched: “${input.query}”` : input?.page ? `Read page ${input.page}` : input?.quote ? 'Checked a quotation' : `Used ${String(c.name).replace('mcp__robercop__', '')}`;
              this.emit(runId, { type: 'activity', label });
            }
            // Without partial messages, text arrives in whole assistant messages.
            if (!caps.includePartialMessages && c.type === 'text' && typeof c.text === 'string') {
              live.text += c.text;
              this.emit(runId, { type: 'text', delta: c.text });
            }
          }
          break;
        }
        case 'rate_limit_event': {
          const info = (ev.rate_limit_info ?? {}) as Record<string, unknown>;
          this.lastUsage = { ...info, at: now() };
          this.emit(runId, { type: 'usage', info });
          if (info.status === 'rejected') rejectedByLimit = true;
          break;
        }
        case 'result':
          resultEvent = ev;
          break;
      }
    };

    child.stdout!.on('data', (d: Buffer) => {
      buffer += d.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) handle(line);
      }
    });
    child.stderr!.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-8000)));

    const code: number | null = await new Promise((resolve) => {
      child.on('error', (err) => {
        stderr += err.message;
        resolve(null);
      });
      child.on('close', resolve);
    });
    if (this.closed) return;
    if (buffer.trim()) handle(buffer.trim());
    writeFileSync(join(dir, 'stderr.log'), stderr);
    this.ingestSearches(run, searchLog);
    if (live.cancelled) return;

    const res = resultEvent as Record<string, unknown> | null;
    const resultText = typeof res?.result === 'string' ? (res.result as string) : '';
    if (!res || res.is_error || code !== 0 || res.subtype !== 'success') {
      const message = resultText || stderr.trim().split('\n').slice(-3).join(' ') || `Claude Code exited with code ${code}.`;
      if (res?._billing) return this.fail(runId, 'auth_required', message, live.text);
      const kind = rejectedByLimit ? 'usage_limited' : classifyFailure(`${message} ${stderr}`, (res?.api_error_status as number) ?? null);
      const friendly =
        kind === 'usage_limited'
          ? `Your Claude usage limit was reached. Your work is saved; try again when the limit resets. (${message.slice(0, 200)})`
          : kind === 'auth_required'
            ? `Claude Code needs you to sign in again. Your work is saved. Run "claude" in a terminal to sign in, then retry. (${message.slice(0, 200)})`
            : message.slice(0, 1000);
      return this.fail(runId, kind, friendly, live.text);
    }

    let structured: unknown = null;
    let proposals: AiProposal[] = [];
    if (schema) {
      const raw = res.structured_output ?? (() => {
        try {
          return extractJson(resultText || live.text);
        } catch {
          return undefined;
        }
      })();
      const parsed = OUTPUT[run.task]!.safeParse(raw);
      if (!parsed.success) {
        writeFileSync(join(dir, 'invalid-output.json'), JSON.stringify({ raw, issues: parsed.error.issues }, null, 2));
        return this.fail(runId, 'failed', 'The assistant returned results in an unexpected format, so nothing was imported. Try again.', live.text || resultText);
      }
      structured = parsed.data;
      proposals = this.createProposals(run, structured);
    }
    this.store.aiRuns.mutate(
      runId,
      (r) => {
        r.status = 'succeeded';
        r.finishedAt = now();
        r.model = model;
        r.outputText = live.text || (schema ? '' : resultText);
        r.structured = structured;
        r.costUsd = typeof res.total_cost_usd === 'number' ? res.total_cost_usd : null;
      },
      SYSTEM
    );
    this.emit(runId, { type: 'status', status: 'succeeded' });
    void proposals;
    this.finish(runId);
  }

  private ingestSearches(run: AiRun, path: string): void {
    if (!existsSync(path) || !run.studyId) return;
    const qids = (run.scope.questionIds as string[] | undefined) ?? [];
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as { query: string; hits: number };
        this.evidence.recordSearch(
          { studyId: run.studyId, assessmentId: run.assessmentId, questionId: qids.length === 1 ? qids[0] : null, query: e.query, hits: e.hits, actor: `assistant (${run.createdBy})`, runId: run.id },
          'assistant'
        );
      } catch {
        /* ignore malformed lines */
      }
    }
  }

  private checkItem(bundle: SourceBundle, item: QuoteItem): SourceCheck {
    return checkQuote(item.quote, bundle.matchable, { claimedPage: item.page, claimedDocumentId: item.documentId || null });
  }

  /** Turns validated structured output into proposals, each quotation checked against the parsed sources. */
  createProposals(run: AiRun, data: unknown): AiProposal[] {
    const bundle = this.documents.bundle(run.studyId!, { includeReferences: true });
    const known = new Set(bundle.documents.map((d) => d.document.id));
    const out: AiProposal[] = [];
    const add = (kind: ProposalKind, target: AiProposal['target'], content: Record<string, unknown>, check: SourceCheck | null) => {
      out.push(
        this.store.proposals.insert(
          { id: newId(), runId: run.id, kind, target, content, check, status: 'pending', createdAt: '', decidedBy: null, decidedAt: null, version: 0 },
          SYSTEM
        )
      );
    };
    const evidence = (item: QuoteItem & { questionIds?: string[]; theme?: string }, questionIds: string[], extra: Record<string, unknown> = {}) => {
      const documentId = known.has(item.documentId) ? item.documentId : null;
      add('evidence', { questionId: questionIds[0] }, { ...item, documentId, questionIds: questionIds.filter((q) => getQuestion(q) || /^C[1-4]$|^A[1-3]$|^CF$/.test(q)), theme: item.theme ?? '', ...extra }, this.checkItem(bundle, item));
    };
    const d = data as Record<string, any>;
    switch (run.task) {
      case 'find_evidence':
        for (const item of d.items) evidence(item, item.questionIds);
        for (const nf of d.notFound) add('missing_info', { questionId: nf.questionId }, nf, null);
        break;
      case 'prepare_domain':
        for (const q of d.questions) {
          for (const item of q.items) evidence(item, [q.questionId]);
          add('missing_info', { questionId: q.questionId }, { summary: q.summary, searchedFor: q.searchedFor, found: q.items.length }, null);
          if (q.suggestedAnswer && (run.scope.includeSuggestions as boolean)) {
            add('answer_suggestion', { questionId: q.questionId }, { suggestedAnswer: q.suggestedAnswer, reasoning: q.suggestionReasoning ?? '', confidence: 'low' }, null);
          }
        }
        break;
      case 'check_missing': {
        const qid = (run.scope.questionIds as string[])[0];
        for (const item of d.items) evidence(item, [qid]);
        add('missing_info', { questionId: qid }, { missing: d.missing, searches: d.searches, conclusion: d.conclusion }, null);
        break;
      }
      case 'draft_rationale':
        add('rationale', { questionId: (run.scope.questionIds as string[])[0] }, { rationale: d.rationale }, null);
        break;
      case 'suggest_answer': {
        const qid = (run.scope.questionIds as string[])[0];
        const allowed = getQuestion(qid)?.options.map((o) => o.code) ?? [];
        const valid = allowed.includes(d.suggestedAnswer);
        add('answer_suggestion', { questionId: qid }, { ...d, valid, items: d.items.map((i: QuoteItem) => ({ ...i, check: this.checkItem(bundle, i) })) }, null);
        break;
      }
      case 'extract_study':
        if (d.citation) add('study_field', { field: 'citation' }, { draft: d.citation }, null);
        for (const f of d.fields) {
          add('study_field', { field: f.field }, { draft: f.draft, type: f.type ?? null, items: f.items.map((i: QuoteItem) => ({ ...i, check: this.checkItem(bundle, i) })) }, null);
        }
        for (const r of d.results) add('study_field', { field: 'result' }, { ...r, items: r.items.map((i: QuoteItem) => ({ ...i, check: this.checkItem(bundle, i) })) }, null);
        break;
      case 'evaluate_confounders':
        for (const f of d.factors) add('confounder', { factor: f.factor }, { ...f, items: f.items.map((i: QuoteItem) => ({ ...i, check: this.checkItem(bundle, i) })) }, null);
        break;
    }
    return out;
  }
}

/** Stops a child process and everything it started (Windows needs taskkill for the process tree). */
export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 3000).unref();
  }
}
