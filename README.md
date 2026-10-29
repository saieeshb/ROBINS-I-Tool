# ROBer COP

A local, human-led workspace for ROBINS-I V2 (20 November 2025) risk-of-bias assessments in systematic reviews.
It runs on your own computer, in your browser. Studies, PDFs and decisions stay in a folder you choose.

Every answer and judgement comes from an explicit reviewer decision. The optional assistant uses the Claude Code you
already have installed and signed in to. It finds and explains evidence in the study PDFs, and it never sets an answer.

> Scope of this release: ITT analyses with Domain 1 Variant A. Results that estimate a per-protocol effect are marked
> unsupported instead of being assessed as ITT.

## Start

You need **Node.js 22.13 or newer** ([nodejs.org](https://nodejs.org), LTS).

| System | How to start |
|---|---|
| macOS | Double-click `start-macos.command` (the first time: right-click → Open) |
| Windows | Double-click `start-windows.cmd` |
| Linux / terminal | `./start-linux.sh` or `node launcher/robercop.mjs` |

On the first run the launcher installs dependencies and builds the app, which takes a minute or two. It then opens
<http://127.0.0.1:4317>. Keep the window open while you work. Work is saved continuously, so closing the window simply
stops the app.

Launcher options:

```bash
node launcher/robercop.mjs --data-dir "/path/to/ROBerCOP data"
```

```bash
node launcher/robercop.mjs --setup-docling
```

- `--data-dir` sets where the data lives; the launcher remembers it. The default is `Documents/ROBerCOP`.
- `--setup-docling` installs the optional Docling parser (Python 3.10–3.13), which gives better layout and table extraction and OCR for scanned pages. Without it, the built-in PDF.js parser is used.
- `--port <n>`, `--no-open` and `--rebuild` are also available; `--help` lists everything.

### The assistant (optional)

Install [Claude Code](https://code.claude.com) and sign in once by running `claude` in a terminal. ROBer COP then
starts the unmodified CLI for each request, using your own Claude sign-in and plan limits. Settings shows the connection
state.

Safeguards around the assistant:

- **No billed API access by default.** API keys and third-party providers are removed from the assistant's environment. If Claude Code reports that it would bill an API key, the run is stopped. API billing can be allowed explicitly in Settings.
- **Read-only access.** The assistant can only search and read the study's parsed sources, through a private read-only tool server. Built-in tools are turned off (no shell, file editing or web access) and there are no approval tools.
- **Your drafts are never at risk.** When your sign-in expires or a usage limit is reached, the run stops with a clear message, the streamed text is kept and your drafts are untouched.
- **Nothing is applied automatically.** Assistant output arrives as proposals: quotations, with their source check, and notes on missing information. You accept or reject each one. Answer suggestions appear only when you ask for them, and accepting a quotation never answers a question.

## Workflow

1. **Project setup.** Name the review and choose the verification mode, which is fixed once verification starts:
   - *Independent*: two reviewers assess each result separately, then reconcile in a consensus record.
   - *Checking*: a second reviewer checks the first assessment question by question.

   Also edit the confounding-factor matrix and attach reference documents, such as consensus outcome definitions.
2. **Study session** (one per study).
   - Attach the PDFs; they are parsed in the background, with page coverage reported.
   - Fill in the target trial (C1–C4), the information sources, and each **numerical result** with its own identity: outcome, time point, comparison, analysis and effect, plus A1–A3 and triage B1–B3.
   - Evaluate the confounders, and build the evidence bank by selecting text in the PDF.
   - **Approve** the study. Domain sessions refer to that approved revision, so no files are passed around.
3. **Domain session** (one per result and reviewer).
   - Navigation, questions and guidance sit beside the PDF.
   - Answer with the keyboard (↑/↓, 1–6, Enter) and link quotations.
   - Fold the navigation or the PDF to a slim rail (buttons, or `[` and `]`) when you need room; jumping to a quotation's page brings the PDF back.
   - The algorithm's suggested judgement is kept separate from yours, and overriding it needs a reason.
   - Answers that become unreachable are kept but excluded from scoring.
   - Submission checks completeness: every reached question answered, every quotation matched or manually checked, and every judgement confirmed.
4. **Verify.** In independent mode, compare the two assessments side by side and resolve each disagreement in a consensus record; both originals are kept. In checking mode, the checker confirms each question or requests a change, the first reviewer responds, and the checker finalizes.
5. **Outputs.** Excel workbook, JSON, and a printable report per assessment with source locations and the decision history.

Light and dark themes follow your system setting; switch with the sun/moon button in the top bar or under Settings → Appearance.

Reviewers on **one computer** share the project directly; choose who is working with the selector at the top right.
Reviewer names are local attribution, not authenticated accounts.

Reviewers on **different computers** exchange review packages (`.robercop.zip`) from *Import / export*:

| Package | Contains |
|---|---|
| Independent assignment | The PDFs, parsed text and approved study details. None of the sender's answers, judgements, notes, question tags or assistant output. |
| Checking assignment | The above plus the submitted first assessment(s), with their evidence and history. |
| Completed review | The sender's own assessments, or the ones they checked with their verification decisions. |

Before you import a package, a preview shows what would change.

- An identical record is skipped.
- A newer version of something only received here is updated.
- Work changed on both computers is never overwritten: you keep the local version or import a copy alongside it.
- If the package's approved study revision differs from the one on this computer, the preview says so.

### Moving from the earlier HTML tool

*Import / export → Import from the earlier ROBINS-I tool* accepts saved Study and Domain session `.json` files and both
Excel exports (standard and Evidence Bank). A preview lists what will be created and what cannot be recovered. Nothing
counts as a decision until a reviewer makes it:

- Imported answers and judgements are marked *imported* and must each be confirmed.
- Imported study details must be reviewed and approved before any assessment can be submitted.
- Free-text evidence without a location is kept beside its answer.
- Evidence-bank quotations are checked once the PDF is attached.

## Data and privacy

Everything lives in the data folder. Back it up like any other documents folder.

| Item | Location |
|---|---|
| SQLite database (with full revision history) | `robercop.sqlite` |
| Original PDFs, stored by content hash | `documents/` |
| Parser output | `parsed/` |
| Assistant run records (prompt, arguments, stream log) | `runs/` |
| Sent packages | `packages/` |

The server listens on `127.0.0.1` only and rejects requests from other sites. Nothing is sent anywhere except the
assistant requests you start, which go through Claude Code.

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run dev:server
```

```bash
npm run dev:web
```

- `npm test` runs the rules, matching, API, exchange, legacy-import and recovery tests.
- `npm run dev:server` and `npm run dev:web` together give a Vite dev server on port 5173 that proxies to the API.
- `npm run test:live` runs one real request through Claude Code. It needs Claude Code signed in, and it uses your plan.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and [docs/RULES_AUDIT.md](docs/RULES_AUDIT.md) for how
the scoring rules were checked against the official release and where the earlier tool differed.

## Licence

MIT for this software. ROBINS-I V2 is developed by its authors; see the official guidance document for its terms of use.
