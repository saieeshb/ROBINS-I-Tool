# Rules audit: legacy tool vs ROBINS-I V2 (20 November 2025)

Ruleset implemented in `packages/rules`: `robins-i-v2@2025-11-20/itt-variant-a/1.0.0`.

Sources checked:

- `ROBINS-I 2025.pdf`: question wording, "If … to …" conditions, response options and Guidance note 17 (overall).
- `D1.png` … `D6.png`, `OVERALL.png`: algorithm diagrams from the same release.
- `robins-i-v2-tool.html` / `robins-i-v2-evidence-bank.html`: legacy branching (`hideIf`) and scoring (`algoD1` … `algoD6`, `renderOverall`).
- `DOMAIN_SESSION_PROMPT.md`: the text algorithms used in the chat workflow.

Where the diagrams and the text prompts disagree, the diagrams (the official release) are used. Every terminal edge of
every diagram has a test in `packages/rules/test/algorithms.test.ts`. A second test walks every reachable answer
combination, checking that each fully answered path produces a judgement and that answers to unreached questions never
change the score.

## Defects found in the legacy HTML tool

| Domain | Legacy behaviour | Official behaviour | Effect |
|---|---|---|---|
| D1 | Q1.1 = Y/PY, Q1.3 = Y/PY, Q1.4 = N/PN returned no judgement | Goes on to Q1.2: Y/PY → **Serious**, WN/SN/NI → **Critical** | Over-adjusted analyses could never be scored |
| D2 | Q2.4 = SY always gave Serious; no path reached Critical; WY with 2.5 = Y/PY gave Moderate | Three-row grid (see diagram): e.g. 2.4 = SY with 2.5 = Y/PY/NI → **Critical**; 2.4 = WY/NI with 2.5 = Y/PY/NI → **Serious** | Systematic under-rating in Domain 2 |
| D2 | Q2.3 = N/PN (problem not avoided) gave Serious regardless of 2.4/2.5 | Bottom row: 2.4 = N/PN and 2.5 = N/PN → Serious; otherwise **Critical** | Under-rating |
| D3 | Q3.5 = N/PN gave Low for part B | Diagram: 3.5 = N/PN/NI → **Moderate** | Under-rating (the text prompt had the same error) |
| D4 | Q4.11 hidden when Q4.6 = Y/PY, but the algorithm then waited for it | Q4.11 is reached whenever Q4.5 = Y/PY/NI; 4.6 = Y/PY → 4.11 Y/PY **Low**, N/PN **Moderate** | Assessments stuck as incomplete |
| D5 | Q5.1 = N/PN, Q5.3 = SY gave Moderate | **Serious** | Under-rating (the text prompt had the same error) |
| D5 | Q5.1 = NI, Q5.2 = N/PN gave Low | **Moderate** | Under-rating (the text prompt had the same error) |
| D5 | Q5.1 = NI, Q5.3 = N/PN gave Low | **Moderate** (WY/N/PN/NI → Moderate on the NI branch) | Under-rating |
| Overall | Automatically escalated: 2+ Serious → Critical, 3+ Moderate → Serious | Default = worst domain. The reviewer *may* override to a greater risk when problems compound, with a reason | Silent escalation without a decision |
| Triage | B3 still required after B2 = Y/PY | B2 = Y/PY ends the assessment; B3 is moot | Minor |

## Interpretations applied

- **NA is not selectable.** In the paper form NA marks unreached questions. The app shows only reached questions and
  prints NA for unreached ones in exports. Legacy imports that carry NA on a reached question are reported as
  *invalid* for that domain instead of being guessed.
- **Q3.1 "SY".** The official diagram and elaboration print "SY", but the response options are WN/SN. Treated as SN.
- **Q4.7 options.** The official list prints `NA / Y / PY / PN / NI`; the algorithm branches on N/PN/NI. N is accepted.
- **Q2.5 elaboration.** The official text says ambiguity in definitions "is likely to lead to a response of 'N' or 'PN'".
  Given the question wording ("Were further classification errors … likely?") ambiguity points to Y/PY. The guidance
  panel shows the official text with this note.
- **Q6.2–6.4** are shown only when Q6.1 = N/PN/NI. The form prints them unconditionally, but the algorithm uses them
  only in that case. This matches the legacy workflow.
- **Q1.4** is always asked (no condition in the form), even on paths where the diagram does not need it
  (Q1.1 = Y/PY, Q1.3 = N/PN/NI, Q1.2 = SN/NI → Serious).
- **Overall compounding.** When two or more domains share the worst judgement at Serious (or Moderate), the app prompts
  the reviewer to consider an additive judgement. Escalation always requires an explicit decision and a reason; the
  overall judgement can never be set lower than the worst domain.
- **Domain overrides** in either direction are allowed but require a written justification (at least 10 characters).
  The algorithm's suggestion is stored separately from the reviewer's final judgement.

## Scope

ITT analyses only (C4 = No), Domain 1 Variant A. A study whose result estimates a per-protocol effect is marked
**unsupported (per-protocol)**. The app does not silently assess it as ITT; the Domain session is blocked until the
reviewer corrects C4 or records the result as out of scope.
