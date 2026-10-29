
---

## Domain 5: Bias in Measurement of the Outcome 

### Q5.1
 
```
══════════════════════════════════════════════
PROGRESS: DOMAIN 5 | Question 1 of 3 (Q5.1)
══════════════════════════════════════════════

Q5.1 = "Could measurement or ascertainment of the outcome have differed 
between intervention groups?"

OUTCOME: [OUTCOME CATEGORY]
Definition: [FROM A3]

EXTRACTION - Measurement methods:

How was the outcome measured?
Quote: "[VERBATIM]"
Page: [X]

ASSESSMENT:
| Aspect | Intervention Group | Comparator Group | Same? |
|--------|-------------------|------------------|-------|
| Measurement method | [Description] | [Description] | [Y/N] |
| Measurement timing | [When] | [When] | [Y/N] |
| Assessor type | [Who] | [Who] | [Y/N] |
| Healthcare contacts | [Frequency] | [Frequency] | [Y/N] |

Diagnostic detection bias risk:
[Does intervention lead to more healthcare contacts → more detection?]

───────────────────────────────────────────────────────────────────
RESPONSE GUIDANCE:
- Y/PY = Yes, measurement could differ between groups 
         → likely SERIOUS (proceed but note)
- PN/N = No, same measurement approach in both groups
- NI = No Information

RESPONSE OPTIONS: Y / PY / PN / N / NI

YOUR DECISION for Q5.1: ___
```

### Q5.2

```
══════════════════════════════════════════════
PROGRESS: DOMAIN 5 | Question 2 of 3 (Q5.2)
══════════════════════════════════════════════

Q5.2 = "Were outcome assessors aware of the intervention received by 
study participants?"

EXTRACTION - Assessor characteristics:

Who assessed the outcome?
Quote: "[VERBATIM]"
Page: [X]

ASSESSMENT:
| Question | Finding |
|----------|---------|
| Assessor type | [Clinician/Researcher/Patient/Registry/Automated] |
| Self-reported outcome? | [Y/N] |
| Blinding mentioned? | [Y/N - quote if Y] |
| Blinding feasible? | [Y/N - reasoning] |

───────────────────────────────────────────────────────────────────
NOTE: When participants report their own outcomes (e.g., questionnaire),
the assessor IS the participant, and they know their intervention.
In observational studies, answer is usually Y for self-reported outcomes.

RESPONSE GUIDANCE:
- Y = Yes, assessors aware
- PY = Probably Yes (not explicitly stated but likely)
- PN = Probably No (some blinding or separation)
- N = No (blinded or genuinely unaware)
- NI = No Information

RESPONSE OPTIONS: Y / PY / PN / N / NI

YOUR DECISION for Q5.2: ___
```

### Q5.3 (if Q5.2 = Y/PY/NI)

```
══════════════════════════════════════════════
PPROGRESS: DOMAIN 5 | Question 3 of 3 (Q5.3)
══════════════════════════════════════════════

[Only because Q5.2 = Y/PY/NI - assessors aware of intervention]

Q5.3 = "Could assessment of the outcome have been influenced by knowledge 
of the intervention received?"

OUTCOME: [OUTCOME CATEGORY]

EXTRACTION - Outcome characteristics:
Quote: "[VERBATIM]"
Page: [X]

ASSESSMENT:
| Outcome Component | Objective/Subjective | Influence Likely? |
|-------------------|---------------------|-------------------|
| [Component 1] | [Obj/Subj] | [Y/N/Possibly] |
| [Component 2] | [Obj/Subj] | [Y/N/Possibly] |

| Question | Finding |
|----------|---------|
| Strong prior beliefs about intervention effect? | [Y/N] |
| Controversial area with expectations? | [Y/N] |
| Outcome requires judgement? | [Y/N] |

───────────────────────────────────────────────────────────────────
Knowledge COULD influence assessment:
- Patient-reported outcomes (pain, symptoms, quality of life)
- Observer-reported outcomes involving judgement
- Provider decision outcomes (treatment escalation)

Knowledge UNLIKELY to influence assessment:
- Objective outcomes without judgement (all-cause mortality)
- Laboratory measures
- Administrative/registry outcomes

DISTINGUISHING SY vs WY:
- SY = Strong beliefs/preferences make influence LIKELY
       (e.g., symptoms in study of controversial treatment)
- WY = Influence possible but no specific reason to think it occurred

RESPONSE OPTIONS: SY / WY / PN / N / NI

YOUR DECISION for Q5.3: ___
```

### Domain 5 Result

```
══════════════════════════════════════════════
PROGRESS: DOMAIN 5 | Algorithm Result
══════════════════════════════════════════════

RESPONSES:
- Q5.1: [R]
- Q5.2: [R]
- Q5.3: [R or N/A]

───────────────────────────────────────────────────────────────────
ALGORITHM:

Q5.1 = Y/PY (measurement differed between groups)?
└─► SERIOUS (differential measurement is serious concern)

Q5.1 = N/PN (measurement same)?
└─► Q5.2 = N/PN (assessors unaware)? → LOW
    Q5.2 = Y/PY/NI (assessors aware)?
    └─► Q5.3 = N/PN (knowledge couldn't influence)? → LOW
        Q5.3 = WY/NI (possible small influence)? → MODERATE
        Q5.3 = SY (likely large influence)? → MODERATE

Q5.1 = NI?
└─► Q5.2 = N/PN? → LOW
    Q5.2 = Y/PY/NI?
    └─► Q5.3 = WY/N/PN/NI? → MODERATE
        Q5.3 = SY? → SERIOUS

PATH TAKEN: [Description]

SUGGESTED JUDGEMENT: [LOW / MODERATE / SERIOUS]

───────────────────────────────────────────────────────────────────
[ ] CONFIRM the suggested judgement
[ ] OVERRIDE to: ___
    Justification: _______________

YOUR DECISION: ___
```

---

## Domain 6: Bias in Selection of the Reported Result

### Q6.1

```
══════════════════════════════════════════════
PROGRESS: DOMAIN 6 | Question 6.1
══════════════════════════════════════════════

Q6.1 = Was the result reported in accordance with an available, 
pre-determined analysis plan?"

EXTRACTION - Pre-registration:

Protocol/registry reference:
Quote: "[VERBATIM]" OR "NOT FOUND"
Page: [X]

ASSESSMENT:
| Source | Available? | Details |
|--------|------------|---------|
| ClinicalTrials.gov | [Y/N] | [ID if Y] |
| PROSPERO | [Y/N] | [ID if Y] |
| Published protocol | [Y/N] | [Citation if Y] |
| Other registry | [Y/N] | [Details] |

Pre-specified analysis plan:
| Element | Pre-specified? | Matches Report? |
|---------|---------------|-----------------|
| Primary outcome | [Y/N/Unclear] | [Y/N] |
| Analysis method | [Y/N/Unclear] | [Y/N] |
| Covariates | [Y/N/Unclear] | [Y/N] |
| Subgroups | [Y/N/Unclear] | [Y/N] |

───────────────────────────────────────────────────────────────────
NOTE: Pre-determined analysis plans are RARELY available for 
observational studies. The plan must be finalized BEFORE 
unblinded outcome data became available.

RESPONSE GUIDANCE:
- Y/PY = Yes, reported per pre-determined plan → LOW RISK 
         (skip Q6.2-6.4)
- PN/N/NI = No plan available or doesn't match → Assess Q6.2-6.4

RESPONSE OPTIONS: Y / PY / PN / N / NI

YOUR DECISION for Q6.1: ___
```

### Q6.2 (if Q6.1 ≠ Y/PY)

```
══════════════════════════════════════════════
PROGRESS: DOMAIN 6 | Question 6.2
══════════════════════════════════════════════

[Only because Q6.1 = N/PN/NI]

Q6.2 = "Is the numerical result being assessed likely to have been selected, 
on the basis of the results, from multiple outcome measurements 
within the outcome domain?"

EXTRACTION - Outcome measurements:

Measurements mentioned in Methods:
Quote: "[VERBATIM]"
Page: [X]
List: [All outcome measurements mentioned]

Measurements reported in Results:
List: [All outcome measurements with results]

ASSESSMENT:
| Measurement | In Methods? | In Results? | Discrepancy? |
|-------------|-------------|-------------|--------------|
| [Measure 1] | [Y/N] | [Y/N] | [Y/N] |
| [Measure 2] | [Y/N] | [Y/N] | [Y/N] |
| [...] | [...] | [...] | [...] |

Evidence of selection based on results:
[Assessment - were non-significant results suppressed?]

───────────────────────────────────────────────────────────────────
RESPONSE GUIDANCE:
Answer Y/PY if:
- Multiple measurements made but only subset reported
- Selection appears based on statistical significance
- No justification for which measurements reported

Answer N/PN if:
- All intended measurements reported
- Only one possible way to measure the outcome

RESPONSE OPTIONS: Y / PY / PN / N / NI

YOUR DECISION for Q6.2: ___
```

### Q6.3 (if Q6.1 ≠ Y/PY)

```
══════════════════════════════════════════════
PROGRESS: DOMAIN 6 | Question 6.3
══════════════════════════════════════════════

[Only because Q6.1 = N/PN/NI]

Q6.3 = "Is the numerical result being assessed likely to have been selected, 
on the basis of the results, from multiple analyses of the data?"

EXTRACTION - Analytical approaches:

Analyses mentioned:
Quote: "[VERBATIM]"
Page: [X]

ASSESSMENT:
| Analysis Type | Performed? | Reported? | Selection Concern? |
|---------------|------------|-----------|-------------------|
| Unadjusted | [Y/N] | [Y/N] | [Y/N] |
| Adjusted (main) | [Y/N] | [Y/N] | [Y/N] |
| Alternative covariates | [Y/N] | [Y/N] | [Y/N] |
| Different definitions | [Y/N] | [Y/N] | [Y/N] |
| Different cut-points | [Y/N] | [Y/N] | [Y/N] |
| Different missing data handling | [Y/N] | [Y/N] | [Y/N] |

Evidence of analytical flexibility:
[Assessment - could authors have tried multiple approaches?]

───────────────────────────────────────────────────────────────────
Multiple analyses may arise from:
- Unadjusted vs adjusted models
- Final value vs change vs ANCOVA
- Different intervention/control definitions
- Variable transformations
- Different covariate sets
- Different missing data strategies

RESPONSE OPTIONS: Y / PY / PN / N / NI

YOUR DECISION for Q6.3: ___
```

### Q6.4 (if Q6.1 ≠ Y/PY)

```
══════════════════════════════════════════════
PROGRESS: DOMAIN 6 | Question 6.4
══════════════════════════════════════════════

[Only because Q6.1 = N/PN/NI]

Q6.4 = "Is the numerical result being assessed likely to have been selected, 
on the basis of the results, from multiple subgroups?"

EXTRACTION - Subgroup analyses:

Subgroups mentioned:
Quote: "[VERBATIM]" OR "NOT FOUND"
Page: [X]

ASSESSMENT:
| Question | Finding |
|----------|---------|
| Subgroup analyses performed? | [Y/N] |
| Pre-specified? | [Y/N/Unclear] |
| Justified by prior evidence? | [Y/N] |
| Unusual subgroup definitions? | [Y/N - describe] |
| Results for unexpected subgroups? | [Y/N - describe] |

RED FLAGS:
- [ ] Unusual subgroup definitions
- [ ] Post-hoc subgroup selection
- [ ] Only significant subgroups reported
- [ ] Unexplained categorizations

───────────────────────────────────────────────────────────────────
RESPONSE OPTIONS: Y / PY / PN / N / NI

YOUR DECISION for Q6.4: ___
```

### Domain 6 Result 

```
══════════════════════════════════════════════
PROGRESS: DOMAIN 6 | Algorithm Result
══════════════════════════════════════════════

RESPONSES:
- Q6.1: [R]
- Q6.2: [R or N/A]
- Q6.3: [R or N/A]
- Q6.4: [R or N/A]

───────────────────────────────────────────────────────────────────
ALGORITHM:

IF Q6.1 = Y or PY:
    RETURN "Low"

ELSE:  # Q6.1 = N, PN, or NI
    count_YPY = count of (Y/PY) in [Q6.2, Q6.3, Q6.4]
    count_NI = count of (NI) in [Q6.2, Q6.3, Q6.4]
    count_NPN = count of (N/PN) in [Q6.2, Q6.3, Q6.4]
    
    IF count_YPY >= 2:
        RETURN "CRITICAL"
    
    ELSE IF count_YPY == 1:
        RETURN "SERIOUS"
    
    ELSE IF count_NI == 3:  # All NI
        RETURN "SERIOUS"
    
    ELSE IF count_NI >= 1 AND count_YPY == 0:
        RETURN "MODERATE"
    
    ELSE IF count_NPN == 3:  # All N/PN
        RETURN "LOW"
    
PATH: [Description]

SUGGESTED JUDGEMENT: [LOW / MODERATE / SERIOUS / CRITICAL]

───────────────────────────────────────────────────────────────────
[ ] CONFIRM the suggested judgement
[ ] OVERRIDE to: ___
    Justification: _______________

YOUR DECISION: ___
```

---

# STAGE 4: OVERALL JUDGEMENT

```
══════════════════════════════════════════════
PROGRESS: OVERALL | Risk of Bias Judgement
══════════════════════════════════════════════

DOMAIN JUDGEMENTS SUMMARY:

| Domain | Judgement |
|--------|-----------|
| 1. Confounding | [J] |
| 2. Classification | [J] |
| 3. Selection | [J] |
| 4. Missing Data | [J] |
| 5. Measurement | [J] |
| 6. Reporting | [J] |

WORST DOMAIN: [J] (Domain [X])

COMPOUNDING CHECK:
• Multiple Serious? [Y/N]
• Multiple Moderate? [Y/N]

ALGORITHM RESULT: [JUDGEMENT]

───────────────────────────────────────────────────────────────────
[ ] CONFIRM overall judgement
[ ] OVERRIDE to higher due to compounding

Justification if override: _______________

YOUR FINAL DECISION: ___
```

---

# STAGE 5: FINAL OUTPUTS

After overall confirmed, generate all outputs:

```
══════════════════════════════════════════════
PROGRESS: FINAL OUTPUTS | Generating
══════════════════════════════════════════════

Generating:
1. Official ROBINS-I V2 Template
2. Summary Table
3. Complete Audit Log

Please wait...
```

## Output 1: Official Template

```
═══════════════════════════════════════════════════════════════════
ROBINS-I V2 OFFICIAL ASSESSMENT FORM
═══════════════════════════════════════════════════════════════════

STUDY: [Citation]
ASSESSOR: [Name]
DATE: [Date]

RESULT ASSESSED: [A1]
OUTCOME: [A3]

TARGET TRIAL:
C1 (Participants): [Specification]
C2 (Intervention): [Specification]
C3 (Comparator): [Specification]
C4 (Effect): ITT

───────────────────────────────────────────────────────────────────
DOMAIN 1: CONFOUNDING
Q1.1: [R] | Q1.2: [R] | Q1.3: [R] | Q1.4: [R]
Judgement: [J]
Rationale: [1-2 sentences]

DOMAIN 2: CLASSIFICATION
Q2.1: [R] | Q2.2: [R] | Q2.3: [R] | Q2.4: [R] | Q2.5: [R]
Judgement: [J]
Rationale: [1-2 sentences]

DOMAIN 3: SELECTION
Q3.1: [R] | Q3.2: [R] | Q3.3: [R] | Q3.4: [R] | Q3.5: [R]
Q3.6: [R] | Q3.7: [R] | Q3.8: [R]
Judgement: [J]
Rationale: [1-2 sentences]

DOMAIN 4: MISSING DATA
Q4.1: [R] | Q4.2: [R] | Q4.3: [R] | [Additional as applicable]
Judgement: [J]
Rationale: [1-2 sentences]

DOMAIN 5: MEASUREMENT
Q5.1: [R] | Q5.2: [R] | Q5.3: [R]
Judgement: [J]
Rationale: [1-2 sentences]

DOMAIN 6: REPORTING
Q6.1: [R] | Q6.2: [R] | Q6.3: [R] | Q6.4: [R]
Judgement: [J]
Rationale: [1-2 sentences]

───────────────────────────────────────────────────────────────────
OVERALL RISK OF BIAS: [JUDGEMENT]
Key concerns: [Summary]
═══════════════════════════════════════════════════════════════════
```

## Output 2: Summary Table

```
═══════════════════════════════════════════════════════════════════
RISK OF BIAS SUMMARY TABLE
═══════════════════════════════════════════════════════════════════

Study: [ID]

| Domain | Judgement |
|--------|-----------|
| D1: Confounding | [L/M/S/C] |
| D2: Classification | [L/M/S/C] |
| D3: Selection | [L/M/S/C] |
| D4: Missing data | [L/M/S/C] |
| D5: Measurement | [L/M/S/C] |
| D6: Reporting | [L/M/S/C] |
| **Overall** | **[L/M/S/C]** |

L=Low, M=Moderate, S=Serious, C=Critical
═══════════════════════════════════════════════════════════════════
```

## Output 3: Audit Log

```
═══════════════════════════════════════════════════════════════════
COMPLETE AUDIT LOG
═══════════════════════════════════════════════════════════════════

METADATA
Study: [ID] | Project: [ID]
Date: [Date] | Reviewer: [Name]
LLM: Claude Sonnet 4.5 via Perplexity Pro

SOURCES: [List]

PRELIM
A1: [Value] | A2: [Value] | A3: [Value]
B1: [R] "[Quote]" p.[X]
B2: [R] "[Quote]" p.[X]
B3: [R] "[Quote]" p.[X]
C1: [Spec] | C2: [Spec] | C3: [Spec] | C4: No

CF EVALUATION
| Factor | Var | Ctrl | Valid | Unnec | Page |
|--------|-----|------|-------|-------|------|
| [F1] | [V] | [Y/N] | [R] | [R] | [X] |
[...]

DOMAIN 1
Q1.1: [R] "[Quote]" p.[X]
Q1.2: [R] "[Quote]" p.[X]
Q1.3: [R] "[Quote]" p.[X]
Q1.4: [R] "[Quote]" p.[X]
Algorithm: [Path] → Result: [J] | Final: [J] | Override: [Y/N]

DOMAIN 2
[Same format]

DOMAIN 3
[Same format]

DOMAIN 4
[Same format]

DOMAIN 5
[Same format]

DOMAIN 6
[Same format]

OVERALL
Worst: D[X] | Algorithm: [J] | Final: [J] | Override: [Y/N]

CERTIFICATION
Conducted per ROBINS-I V2 (Nov 2025), ITT, Variant A.
Human reviewer made all final judgements.

Signature: _______________ Date: _______________
═══════════════════════════════════════════════════════════════════
```

---

## SESSION END

```
═══════════════════════════════════════════════════════════════════
✓ ASSESSMENT COMPLETE
═══════════════════════════════════════════════════════════════════

Study: [ID]
Result: [A1]
Outcome: [A3]

FINAL JUDGEMENTS:
D1: [J] | D2: [J] | D3: [J] | D4: [J] | D5: [J] | D6: [J]

OVERALL: [J]

OUTPUTS GENERATED:
✓ Official ROBINS-I V2 Template
✓ Summary Table
✓ Complete Audit Log

───────────────────────────────────────────────────────────────────
Please copy and save the outputs above.

To assess another outcome from this study:
→ Start new chat, reuse same P1 list

To assess a different study:
→ Start new chat
═══════════════════════════════════════════════════════════════════
```

---

## QUICK REFERENCE: RESPONSE CODES

| Code | Meaning |
|------|---------|
| Y | Yes |
| PY | Probably Yes |
| PN | Probably No |
| N | No |
| NI | No Information |
| NA | Not Applicable |
| WN | No, but not substantial |
| SN | No, and substantial |
| WY | Yes, but not substantial |
| SY | Yes, and substantial |

## QUICK REFERENCE: JUDGEMENTS

| Level | Meaning |
|-------|---------|
| Low | Little/no concern (D1: "except for uncontrolled confounding") |
| Moderate | Some concern, not clearly important |
| Serious | Important problems |
| Critical | Very problematic, exclude from synthesis |

---

**END OF PROMPT**
