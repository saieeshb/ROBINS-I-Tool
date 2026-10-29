# ROBer COP architecture

## Shape

```
launcher/robercop.mjs ──starts──▶ apps/server (Fastify, Node ≥ 22.13, 127.0.0.1:4317)
                                     ├── serves apps/web (React + TypeScript, built by Vite)
                                     ├── SQLite (node:sqlite, WAL) in the data folder
                                     ├── parse queue ──▶ python/docling_worker.py (optional) or PDF.js (built in)
                                     └── assistant runs ──▶ `claude -p` (installed CLI) ──▶ mcp/main.ts (read-only tools)
packages/rules   versioned ROBINS-I V2 rules (pure, no dependencies)
packages/shared  data model, quotation matching, assessment evaluation (pure; used by server and browser)
```

One process serves the API and the web app from the same loopback origin. The browser and the server share the rules
and evaluation code. The browser therefore shows the same completeness problems, suggestions and reached paths that the
server enforces on submit and finalize.

## Records

The data model is in `packages/shared/src/model.ts`; storage is in `apps/server/src/db`.

| Record | Notes |
|---|---|
| Project | Verification mode (locked once verification starts), CF matrix, ruleset version |
| Study / StudyRevision | Study content is edited freely. Approval freezes an immutable revision with a SHA-256 content hash. Domain sessions reference a revision. A legacy import creates a revision marked `legacy import (not reviewed)`, which never counts as an approval. |
| ResultSpec | One numerical result: outcome, time point, comparison, analysis, effect, A1–A3, triage, important confounders |
| SourceDocument / ParseJob / SourceBlock | PDFs stored by content hash. Each parse is a job (queued, running, succeeded, failed, cancelled or interrupted) with coverage and provenance. Blocks are indexed in FTS5. |
| EvidenceItem + SourceCheck | A quotation or note with its deterministic source check. Study-level items form the evidence bank; items created inside an assessment belong to it. |
| AiRun / AiProposal / SearchRecord | What was asked, which context revision was used, what came back, and each search with its hit count |
| Assessment | Per-question responses (answer, rationale, linked evidence, decided by/at, origin) and domain and overall decisions (final, suggestion at the time of the decision, reason, ruleset). |
| VerificationDecision | Checking mode: confirm, change request or disagreement per question or judgement, with the response to it |
| Consensus assessment + ConsensusItem | Independent mode: a separate record pointing at both originals, with one item per disagreement |
| Package | Every review package sent or received, with its manifest and import notes |

Every write goes through `Collection`, which:

- checks the version optimistically: a stale write returns 409 together with the current record;
- records a revision. Consecutive autosaves by the same reviewer within two minutes are merged into one revision, and milestones (submit, approve, reopen, import) are always separate. The printable report turns these revisions into a decision log.

## Decisions and invalidation

These rules live in `apps/server/src/services/assessments.ts` and `packages/shared/src/assessment.ts`.

- **Answers.** Changing or confirming an answer records the acting reviewer and the time. Imported answers keep `origin: legacy_import` until a reviewer confirms them.
- **Judgements.** Changing an answer marks that domain's judgement and the overall judgement for reconfirmation. Moving to a newer study revision does the same for D1 when only the confounders changed, and for all domains otherwise.
- **Evidence.** Changing a linked quotation, or a source re-parse that changes its check result, flags the answer that relies on it.
- **Scoring.** Answers to questions that become unreachable are kept but excluded from scoring.
- **Completeness.** It is enforced on submit and on finalize, never while drafting.

## Scoring

`packages/rules` implements `robins-i-v2@2025-11-20/itt-variant-a/1.0.0`:

- A `Walker` follows each domain's diagram and records the reached path, the next needed question, and the excluded answers.
- Triage and the overall default (worst domain, with a compounding prompt that is never applied automatically) are separate modules.
- Tests cover every diagram edge and enumerate every reachable answer combination.

[RULES_AUDIT.md](RULES_AUDIT.md) lists where the earlier tool differed.

## Parsing and quotation checks

The parse queue (`apps/server/src/parsing/service.ts`) is persistent:

- Jobs survive restarts, and an interrupted job is requeued, up to three attempts.
- With the parser set to *auto*, Docling is used when installed and the built-in PDF.js parser otherwise.
- If Docling fails, PDF.js runs as a fallback.
- Both parsers produce blocks with page, section, kind, bounding box and OCR flag, plus Markdown with page markers.

`checkQuote` (`packages/shared/src/match.ts`) is deterministic:

1. **Exact** match.
2. **Normalized** match: whitespace, hyphenation, quotes, dashes, ligatures and case-folding only for candidates.
3. **Elided** match: segments separated by "…" found in order.

The result is *matched*, *ambiguous* (several locations), *unmatched*, or *incomplete extraction* (the source has pages without text). Similarity is used only to offer candidates, never to declare a match. A re-parse rechecks every quotation of the study, and manual checks are kept with the reviewer's note.

## Assistant runner

`apps/server/src/ai/runner.ts` implements the replaceable `AiRunner` interface with `ClaudeCodeRunner`.

**Before a run starts:**

- `claude --version`, `claude auth status --json` and `claude --help` are checked. This uses no quota, and the help output shows which flags are supported.
- A run refuses to start when the CLI is signed out or set up for billed API access, unless API billing is explicitly allowed.

**How the CLI is started:**

- `-p --output-format stream-json --verbose --include-partial-messages`
- `--tools ""`, so no built-in tools are available.
- `--mcp-config <run>/mcp.json --strict-mcp-config --allowedTools mcp__robercop__*`
- `--permission-mode dontAsk --permission-prompts none --no-session-persistence --disable-slash-commands`
- `--setting-sources project`, so the reviewer's own plugins and hooks are not loaded.
- `--system-prompt-file` and `--json-schema` for structured tasks.

It never uses `--bare`, which would drop subscription sign-in. The prompt goes in on stdin, and `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and the Bedrock/Vertex switches are removed from the child's environment.

**While it runs:**

- The stream is parsed for text, tool activity and rate-limit events. If `system/init` reports an API key source, the run is stopped.
- Structured output is validated with zod; invalid output imports nothing.
- Evidence proposals are checked against the sources before they are shown.
- Runs end as *succeeded*, *failed*, *cancelled*, *usage limited*, *sign-in required* or *interrupted*. Streamed text is kept for every outcome, and drafts are never touched.

**The read-only tool server.** `apps/server/src/mcp/main.ts` is a stdio MCP server over a read-only SQLite connection. It can see only the study's documents: `list_sources`, `search_source`, `get_page`, `get_blocks` and `check_quote`. Every search, with its hit count, is logged to the run folder and recorded, and zero hits never selects NI automatically.

## Review packages

The package service is `apps/server/src/services/packages.ts`; the format is `robercop-review-package` version 1, a ZIP containing:

```
manifest.json                      kind, sender, origin installation, project, study + approved revision hash, SHA-256 of every file
study/revisions.json, study.json   approved revision(s) the content depends on
documents/index.json, <id>.pdf     sources (content-addressed)
parsed/<job>/job.json, blocks.json, document.md
evidence/evidence.json
assessments/<id>.json, .history.json, .verifications.json, .consensus.json
```

**Kinds:**

- Independent assignments strip question tags and all assessment-level evidence, and include no assessments.
- Checking assignments include submitted first assessments.
- Completed reviews include the sender's own assessments, or the ones they checked.

**Import:**

- The checksums are verified before anything else.
- The preview compares study revisions: same, new study, older here, or changed.
- For each incoming assessment, the content and both histories are compared:
  - *identical*: skipped.
  - *update*: the local version appears in the incoming history, so it is replaced and the history is kept.
  - *older*: the incoming version appears in the local history, so the local copy is kept.
  - *conflict*: changed on both sides. Never overwritten; the local version is kept, or the incoming one is imported as a separate copy.
- Verification decisions only move forward: open → resolved → superseded.

## Exports

`apps/server/src/services/exports.ts` produces three outputs, all limited to the assessments the viewer may see under independent blinding:

- **Excel workbook:** About, Judgements, Domains, Answers, Verification, Results, Confounders and Evidence sheets.
- **JSON:** records plus the evaluation and decision log.
- **Printable report:** self-contained HTML per assessment with source locations, verification and the decision history.

## Recovery

At start-up, interrupted parse jobs are requeued and assistant runs left running are marked interrupted. On shutdown the
parse queue and the assistant runner stop without writing, so the next start sees a consistent state. Clients keep
unsaved edits in local storage, retry when offline, and show a conflict instead of overwriting newer work.

## Local security

- The server binds to `127.0.0.1` and rejects any non-loopback `Host`, which defeats DNS rebinding.
- Every state-changing API call must carry `X-Robercop: 1`. This forces a CORS preflight that the server never grants, so other websites cannot trigger actions.
- Reviewer names travel in `X-Reviewer` for attribution only.
