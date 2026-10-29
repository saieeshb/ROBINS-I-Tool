This repository contains ROBer COP, a local browser-based tool for easy use of the ROBINS-I v2 tool while conducting risk of bias analysis on included studies in a systematic review. It is a manual, human-led tool; the optional assistant (Claude Code) only finds and explains evidence.

Layout: `apps/server` (Fastify + SQLite), `apps/web` (React), `packages/rules` (versioned ROBINS-I V2 scoring rules), `packages/shared` (data model, quote matching, evaluation), `launcher/` (start scripts), `python/` (optional Docling parser), `docs/` (architecture, rules audit, reference guides). Run `npm test` and `npm run typecheck` before committing.

`docs/reference/` holds the source material:
- `ROBINS-I 2025.pdf` is the official guide.
- The png files have the domain algorithms mapped, which are also included in the session prompts.
- The session prompt files hold the old architecture of a human in the loop workflow (chat based).

The earlier single-file HTML tools were removed; they remain in the git history. The app still imports their saved JSON sessions and Excel exports.

The app does not yet completely fulfill my vision for the optimal tool. I will be guiding you on my vision.
