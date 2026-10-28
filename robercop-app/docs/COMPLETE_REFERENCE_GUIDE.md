# ROBINS-I V2 LLM Reference Guide
## Complete Knowledge Base for LLM-Assisted Risk of Bias Assessment

**Version**: 1.0  
**Based on**: ROBINS-I V2 (20 November 2025)  
**Scope**: ITT analyses only; Domain 1 Variant A only

---

# 1. INTRODUCTION AND LLM ROLE

## 1.1 Purpose

This reference guide provides an LLM assistant with the complete knowledge base required to help human reviewers conduct ROBINS-I V2 risk of bias assessments for non-randomized studies of interventions.

## 1.2 What is ROBINS-I V2?

ROBINS-I (Risk Of Bias In Non-randomized Studies – of Interventions) Version 2 is a tool for assessing risk of bias in a **specific result** from a non-randomized study examining the effect of an **intervention strategy** versus a **comparator strategy** on an **outcome**.

## 1.3 LLM Role Definition

### The LLM MUST:
- Guide the workflow sequentially through all stages
- Prompt the human for required inputs at each step
- Extract relevant evidence from source documents (verbatim quotes with page/section references)
- Present extracted evidence in structured formats
- Apply decision algorithms to generate SUGGESTED risk-of-bias judgements
- Explain concepts from the guidance notes when requested
- Ask for explicit confirmation before proceeding to each new step

### The LLM MUST NOT:
- Make final risk-of-bias judgements (humans decide)
- Skip steps or combine multiple steps without permission
- Proceed without human confirmation
- Assume information not present in source documents
- Override human decisions

## 1.4 Scope Constraints

This guide is configured for:
- **ITT (Intention-to-Treat) analyses only**
- **Domain 1 Variant A only** (baseline confounding)
- **No direction of bias predictions**
- **Audit log generated at end only**

## 1.5 Risk of Bias Categories

| Judgement | Interpretation |
|-----------|----------------|
| **Low risk** | Little or no concern about bias. For Domain 1: "Low risk (except for concerns about uncontrolled confounding)" |
| **Moderate risk** | Some concern about bias, but not clear that there is important risk |
| **Serious risk** | Important problems giving rise to serious risk of bias |
| **Critical risk** | Very problematic; result should generally be excluded from syntheses |

---

# 2. WORKFLOW OVERVIEW

## 2.1 Complete Workflow Stages

```
PLANNING STAGE (Once per project)
└── P1: List Important Confounding Factors (human responsibility)

PRELIM STAGE (For each study-outcome pair)
├── A: Specify the Result (A1-A3)
├── B: Triage Questions (B1-B3) → Can terminate with Critical
├── C: Target Trial Specification (C1-C4)
└── D: Information Sources

RoB ASSESSMENT STAGE (For each study-outcome pair)
├── Evaluation of Confounding Factors
├── Domain 1: Confounding (Variant A)
├── Domain 2: Classification of Interventions
├── Domain 3: Selection of Participants
├── Domain 4: Missing Data
├── Domain 5: Measurement of Outcome
├── Domain 6: Selection of Reported Result
├── Overall Risk of Bias Judgement
└── Generate Audit Log
```

## 2.2 Early Termination

**Assessment terminates with CRITICAL risk if:**
- B2 = Y/PY (insufficient confounding control)
- B3 = Y/PY (inappropriate outcome measurement)

---

# 3. PLANNING STAGE: CONFOUNDING FACTORS (P1)

## 3.1 Overview

**When**: Once per project, before any study assessments  
**Who**: Human responsibility  
**Output**: Project-level list of important confounding factors

## 3.2 Key Definitions [Guidance Note 1]

**Confounding Factor**: A prognostic factor (predictor of the outcome) that also predicts whether participants receive the intervention or comparator strategy.

**Important Confounding Factor**: A confounding factor with potential to introduce **material bias**. Factors with only very weak associations with intervention or outcome need not be considered.

## 3.3 Guidance for Identifying Confounders [Guidance Note 1]

- Requires **content knowledge** of the clinical/research domain
- May be informed by relevant literature
- Should be specified at the research question level
- If certain factors are specific to particular intervention-outcome combinations, state this

## 3.4 LLM Prompt Template

```
═══════════════════════════════════════════════════════════════════
PLANNING STAGE P1: IMPORTANT CONFOUNDING FACTORS
═══════════════════════════════════════════════════════════════════

Before beginning assessments, please provide the list of IMPORTANT 
CONFOUNDING FACTORS for this project.

These are prognostic factors (predictors of outcome) that also predict 
whether participants receive intervention or comparator.

For each factor, provide:
1. Factor name
2. Why it is prognostic for the outcome
3. Why it might predict intervention receipt
4. Whether it applies to all or specific intervention-outcome pairs

AWAITING YOUR INPUT.
═══════════════════════════════════════════════════════════════════
```

---

# 4. PRELIM STAGE A: SPECIFY THE RESULT

## 4.1 Overview

**When**: For each study-outcome pair  
**Who**: Human provides; LLM helps structure  
**Output**: Completed A1-A3 fields

## 4.2 Key Concept [Guidance Note 3]

A ROBINS-I assessment is **specific to a particular study result**. Different results from the same study may be at different risks of bias (e.g., unadjusted vs. adjusted estimates).

## 4.3 Questions

### A1. Specify the numerical result being assessed
The exact effect estimate with confidence interval.
*Example*: "HR = 0.72 (95% CI: 0.58-0.89)"

### A2. Provide further details (optional)
Location in report, reason for selection.

### A3. Specify the outcome
Outcome name, measurement method, time point, definitions.

## 4.4 LLM Prompt Template

```
═══════════════════════════════════════════════════════════════════
PRELIM STAGE A: SPECIFY THE RESULT
═══════════════════════════════════════════════════════════════════

Study: [STUDY ID]

Please provide:

A1. NUMERICAL RESULT: The exact effect estimate with CI
    Example: "HR = 0.72 (95% CI: 0.58-0.89)"

A2. LOCATION/CONTEXT (optional): Where reported, why selected

A3. OUTCOME: Definition, measurement method, time point

AWAITING YOUR INPUT.
═══════════════════════════════════════════════════════════════════
```

---

# 5. PRELIM STAGE B: TRIAGE QUESTIONS

## 5.1 Overview

**When**: After A1-A3 confirmed  
**Who**: Human answers; LLM extracts evidence  
**Output**: B1-B3 answers; proceed or terminate with Critical

## 5.2 Purpose [Guidance Note 4]

Some characteristics lead directly to Critical risk, making detailed assessment unnecessary. Triage identifies these situations.

## 5.3 Early Termination Rule

**If B2 = Y/PY OR B3 = Y/PY → CRITICAL RISK → STOP**

---

## 5.4 Question B1

**"Did the authors make any attempt to control for confounding in the result being assessed?"**

| Response | Meaning |
|----------|---------|
| Y | Yes |
| PY | Probably Yes |
| PN | Probably No |
| N | No |

**LLM Extraction Task**: Search for adjustment methods, covariates, propensity scores, matching, stratification, regression with covariates.

---

## 5.5 Question B2

**Conditional**: Only if B1 = N or PN

**"Is there sufficient potential for confounding that this result should not be considered further?"**

| Response | Meaning |
|----------|---------|
| Y | Yes → **CRITICAL RISK - STOP** |
| PY | Probably Yes → **CRITICAL RISK - STOP** |
| PN | Probably No |
| N | No |

**LLM Extraction Task**: Baseline imbalances, obvious prognostic differences between groups.

---

## 5.6 Question B3

**"Was the method of measuring the outcome inappropriate?"**

| Response | Meaning |
|----------|---------|
| Y | Yes → **CRITICAL RISK - STOP** |
| PY | Probably Yes → **CRITICAL RISK - STOP** |
| PN | Probably No |
| N | No |

**Criteria for Y/PY** [Guidance Note 4]:
1. Important outcome values outside detectable range
2. Instrument demonstrated to have poor reliability/validity
3. Measurement method differed substantially between groups

**Note**: In most circumstances, answer will be N or PN.

**LLM Extraction Task**: Outcome measurement description, validation information, same method in both groups.

---

# 6. PRELIM STAGE C: TARGET TRIAL SPECIFICATION

## 6.1 Overview

**When**: After Triage (Stage B) passed  
**Who**: LLM drafts; human confirms  
**Output**: C1-C4 completed

## 6.2 The Target Trial Concept [Guidance Note 5]

The non-randomized study is considered as an attempt to emulate a **pragmatic randomized trial** (the target trial). This is a hypothetical trial whose results would match the non-randomized study in absence of bias.

**Key points**:
- Ethics and feasibility need not be considered (it's hypothetical)
- Specifying the target trial involves "reverse engineering" the research question from the analysis

---

## 6.3 Question C1: Participants and Eligibility [Guidance Note 6]

**"Specify the participants and eligibility criteria"**

Eligible participants are determined by study eligibility criteria. May require careful consideration of restrictions applied.

**LLM Extraction Task**: Inclusion/exclusion criteria, population description, flow diagram, sample derivation.

---

## 6.4 Question C2: Intervention Strategy [Guidance Note 7]

**"Specify the intervention strategy"**

May be:
- **Point intervention**: Single time (surgery, vaccine dose)
- **Sustained intervention**: Over time (continuing drug treatment)

For ITT analyses: Detailed specification over time not necessary.

**LLM Extraction Task**: Intervention description, timing, dose/frequency/duration, classification method.

---

## 6.5 Question C3: Comparator Strategy [Guidance Note 7]

**"Specify the comparator strategy"**

May be:
- Alternative active intervention
- Standard care
- No intervention

**LLM Extraction Task**: Comparator description, definition, what comparator group received.

---

## 6.6 Question C4: ITT vs Per-Protocol [Guidance Note 8]

**"Did the analysis account for switches during follow-up between intervention strategies, or for other protocol deviations?"**

| Response | Meaning | Domain 1 Variant |
|----------|---------|------------------|
| No | ITT effect | Variant A |
| Yes | Per-protocol effect | Variant B |

**FOR THIS PROJECT: C4 = "No" (ITT) for all studies**

This means:
- Domain 1 Variant A used
- Only baseline confounding assessed
- No time-varying confounding assessment

---

# 7. PRELIM STAGE D: INFORMATION SOURCES

## 7.1 Overview

**When**: After Target Trial (Stage C) complete  
**Who**: Human confirms available sources  
**Output**: Checklist of sources used

## 7.2 Purpose [Guidance Note 9]

Evaluation should be based on maximum available information:
- Published articles
- Study protocol
- Unpublished reports
- Correspondence with investigators
- Registry records

## 7.3 Source Checklist

| Source Type | Description |
|-------------|-------------|
| Journal article(s) | Main publication, related articles |
| Study protocol | Pre-specified design/analysis |
| Statistical analysis plan | Detailed analysis specifications |
| Registry record | ClinicalTrials.gov, etc. |
| Grey literature | Thesis, conference proceedings |
| Regulatory documents | Clinical Study Reports |
| Individual participant data | Raw data if available |
| Personal communication | Contact with authors/sponsors |

## 7.4 LLM Prompt Template

```
═══════════════════════════════════════════════════════════════════
PRELIM STAGE D: INFORMATION SOURCES
═══════════════════════════════════════════════════════════════════

Study: [STUDY ID]

Please confirm available sources (check all that apply):

[ ] Journal article(s): _______________
[ ] Study protocol: _______________
[ ] Statistical analysis plan: _______________
[ ] Registry record: _______________
[ ] Grey literature: _______________
[ ] Regulatory documents: _______________
[ ] Other: _______________

AWAITING YOUR CONFIRMATION.
═══════════════════════════════════════════════════════════════════
```

---

**END OF PART A**

*Continue to Part B: Confounding Factor Evaluation*
# ROBINS-I V2 LLM Reference Guide - Part B

# 8. RoB ASSESSMENT: EVALUATION OF CONFOUNDING FACTORS

## 8.1 Overview

**When**: After PRELIM Stage D; before Domain 1  
**Who**: LLM extracts evidence; human makes classification decisions  
**Output**: Completed confounding factor evaluation table; required input for Domain 1

## 8.2 Purpose [Guidance Note 10]

Confounding is of fundamental importance. This evaluation reviews the extent to which the result was controlled for confounding, considering both:
- Prespecified confounding factors (from P1)
- Any additional factors identified as important in this study

## 8.3 Key Definitions [Guidance Note 10]

**Baseline Confounding**: Occurs when prognostic factors present BEFORE follow-up start predict whether participants start intervention or comparator. This is the only type assessed for ITT analyses.

**Confounding Factor vs. Measured Variable**: The confounding factor is the construct; variables are used to measure it. Variables may be imperfect measures of the underlying factor.

## 8.4 When Control May Be Unnecessary [Guidance Note 10]

Control for a confounder may NOT be necessary if:

| Condition | Explanation |
|-----------|-------------|
| (a) Not associated with outcome | Factor not associated with outcome conditional on intervention |
| (b) Not associated with intervention | Factor not associated with intervention receipt |
| (c) Adjustment makes no difference | Controlling makes minimal difference to estimate |
| (d) Addressed by design | Restriction, matching in design phase |
| (e) Negative control evidence | Negative controls demonstrate minimal confounding |
| (f) External evidence | External evidence suggests control unnecessary |

## 8.5 Table Structure

For each confounding factor, evaluate:

| Column | Question | Options |
|--------|----------|---------|
| **Confounding factor** | Factor name | Text |
| **Measured variable(s)** | What variable(s) measured this factor? | Text or "Not measured" |
| **Controlled for?** | Was this controlled in the analysis? | Y / N |
| **Valid/reliable measurement?** | If controlled, was measurement valid/reliable? | NA / Y / PY / PN / N / NI |
| **Control unnecessary?** | If NOT controlled, evidence control unnecessary? | NA / Y / PY / PN / N |
| **Comments** | Additional information | Text |

### Response Definitions

**Valid/reliable measurement**:
- **Validity**: Variable accurately measures the confounding factor
- **Reliability**: Precision of measurement (more error = less reliability)

**Control unnecessary**: Reference conditions (a)-(f) in Section 8.4.

## 8.6 LLM Extraction Task

For each P1 confounding factor, search for:

- [ ] Was this factor mentioned as a potential confounder?
- [ ] What variable(s) were used to measure it?
- [ ] Was it included in the analysis?
- [ ] How was it measured (data source, instrument, timing)?
- [ ] Measurement validity/reliability information?
- [ ] If not controlled, any justification provided?

Also search for:
- [ ] Additional confounders mentioned but not on P1 list
- [ ] Table 1 / baseline characteristics comparison
- [ ] Methods section on covariate selection

## 8.7 LLM Presentation Template (Per Factor)

```
═══════════════════════════════════════════════════════════════════
CONFOUNDING FACTOR EVALUATION: [FACTOR NAME]
═══════════════════════════════════════════════════════════════════

Factor: [NAME] (P1 list / study-specific)

EXTRACTED EVIDENCE:

Was factor measured?
Quote: "[VERBATIM]"
Location: [Page/Section]

Variable(s) used:
Quote: "[VERBATIM]"
Location: [Page/Section]

Controlled for in analysis?
Quote: "[VERBATIM]"
Location: [Page/Section]
Method: [Regression / Matching / Stratification / etc.]

Measurement validity/reliability:
Quote: "[VERBATIM]"
Location: [Page/Section]

If NOT controlled - evidence control unnecessary:
Quote: "[VERBATIM]"
Location: [Page/Section]
Condition: [(a)-(f) from Section 8.4]

───────────────────────────────────────────────────────────────────
SUGGESTED TABLE ENTRIES:

| Field | Entry |
|-------|-------|
| Measured variable(s) | [SUGGESTION] |
| Controlled for? | [Y/N] |
| Valid/reliable? | [RESPONSE] |
| Control unnecessary? | [RESPONSE] |
| Comments | [SUGGESTION] |

HUMAN DECISION REQUIRED: Confirm or modify.
═══════════════════════════════════════════════════════════════════
```

## 8.8 LLM Presentation Template (Complete Table)

```
═══════════════════════════════════════════════════════════════════
CONFOUNDING FACTOR EVALUATION: COMPLETE TABLE
═══════════════════════════════════════════════════════════════════

Study: [STUDY ID]
Result: [FROM A1]

(i) P1 CONFOUNDING FACTORS

| Factor | Variable(s) | Controlled? | Valid/Reliable? | Control Unnecessary? | Comments |
|--------|-------------|-------------|-----------------|---------------------|----------|
| [F1] | [Vars] | [Y/N] | [Response] | [Response] | [Text] |
| [F2] | [Vars] | [Y/N] | [Response] | [Response] | [Text] |

(ii) ADDITIONAL STUDY-SPECIFIC FACTORS

| Factor | Variable(s) | Controlled? | Valid/Reliable? | Control Unnecessary? | Comments |
|--------|-------------|-------------|-----------------|---------------------|----------|
| [F] | [Vars] | [Y/N] | [Response] | [Response] | [Text] |

───────────────────────────────────────────────────────────────────
SUMMARY FOR DOMAIN 1:

Confounders controlled: [N] of [Total]
Confounders NOT controlled (control NOT shown unnecessary): [N]
  → [List these factors]

Measurement concerns (PN/N/NI for validity):
  → [List factors]

───────────────────────────────────────────────────────────────────
HUMAN CONFIRMATION REQUIRED.
Once confirmed, proceed to Domain 1.
═══════════════════════════════════════════════════════════════════
```

---

**END OF PART B**

*Continue to Part C: Domain 1 - Bias Due to Confounding*
# ROBINS-I V2 LLM Reference Guide - Part C

# 9. RoB ASSESSMENT: DOMAIN 1 - BIAS DUE TO CONFOUNDING

## 9.1 Overview

**When**: After Confounding Factor Evaluation complete  
**Variant**: A (ITT effect - baseline confounding only)  
**Inputs Required**: Completed confounding factor evaluation table  
**Output**: Domain 1 risk of bias judgement

## 9.2 Key Concepts [Guidance Note 11]

**Uncontrolled confounding**: Confounding not controlled by design or analysis, likely to bias the estimated effect. May arise because:
1. Confounding factors not measured
2. Variables insufficient to characterize the factor
3. Variables measured but not included in analysis

**Appropriate control methods**:
- Stratification
- Regression
- Matching
- Standardization
- Inverse probability weighting
- Propensity score methods

---

## 9.3 Signalling Questions

### Question 1.1

**"Did the authors control for all the important confounding factors for which this was necessary?"**

| Code | Meaning | Risk Path |
|------|---------|-----------|
| Y | Yes | → Low |
| PY | Probably Yes | → Low |
| WN | No, but uncontrolled confounding probably not substantial | → Moderate |
| SN | No, and uncontrolled confounding probably substantial | → Serious |
| NI | No Information | → Serious |

**Answer Guidance**:
- **Y/PY**: All important confounders for which control was necessary were controlled appropriately. Also Y/PY if (rarely) no confounding factors exist.
- **WN**: Most controlled; uncontrolled factors likely highly correlated with controlled factors.
- **SN**: At least one important confounder should have been controlled but wasn't, and failure likely has material impact.

**LLM Task**: Reference confounding factor evaluation table. List uncontrolled factors and assess whether control was shown unnecessary.

---

### Question 1.2

**Conditional**: Only if Q1.1 = Y, PY, or WN

**"Were confounding factors that were controlled for (and for which control was necessary) measured validly and reliably by the variables available in this study?"**

| Code | Meaning | Risk Path |
|------|---------|-----------|
| NA | Not Applicable | - |
| Y | Yes | → Low |
| PY | Probably Yes | → Low |
| WN | No, but measurement error probably not substantial | → Moderate |
| SN | No, and measurement error probably substantial | → Serious |
| NI | No Information | → Varies |

**Answer Guidance**:
- Valid/reliable measures may be cited in study or listed in review protocol
- If no indication of validity, evaluate subjectivity of measure
- If no confounding factors (rare), answer Y/PY

**LLM Task**: Reference validity/reliability column from confounding factor evaluation.

---

### Question 1.3

**Conditional**: Only if Q1.1 = Y, PY, or WN

**"Did the authors control for any post-intervention variables that could have been affected by the intervention?"**

| Code | Meaning | Risk Path |
|------|---------|-----------|
| NA | Not Applicable | - |
| Y | Yes (over-adjustment) | → Serious |
| PY | Probably Yes | → Serious |
| PN | Probably No | → Low |
| N | No | → Low |
| NI | No Information | → Moderate |

**Key Concepts**:
- **Mediator**: Variable on causal pathway from intervention to outcome. Controlling estimates direct effect and may introduce bias.
- **Collider**: Common effect of intervention and outcome. Controlling introduces bias.

**LLM Extraction Task**:
- List ALL variables controlled for
- For each: Was it measured BEFORE or AFTER intervention start?
- Could any be affected by intervention (mediator or collider)?

---

### Question 1.4

**"Did the use of negative controls, quantitative bias analysis, or other considerations, suggest serious uncontrolled confounding?"**

| Code | Meaning | Risk Path |
|------|---------|-----------|
| Y | Yes | → Serious/Critical |
| PY | Probably Yes | → Serious |
| PN | Probably No | → Lower |
| N | No | → Lower |

**Answer Guidance**:
- If study did NOT use negative controls and nothing else suggests confounding: answer **'N'**
- Answer Y/PY if negative controls indicate material confounding bias

**LLM Extraction Task**:
- Negative control outcomes/exposures
- E-values or quantitative bias analyses
- Sensitivity analyses for unmeasured confounding
- Author discussion of residual confounding

---

## 9.4 Domain 1 Variant A: Algorithm

```
DOMAIN 1 VARIANT A ALGORITHM
═══════════════════════════════════════════════════════════════════

Q1.1 = Y or PY?
├─► Q1.3 = N, PN, or NI?
│   ├─► YES → Q1.2 = Y or PY?
│   │         ├─► YES → Q1.4 = N or PN? → LOW*
│   │         │         Q1.4 = Y or PY? → SERIOUS
│   │         │
│   │         Q1.2 = WN?
│   │         ├─► Q1.4 = N or PN? → LOW*
│   │         │   Q1.4 = Y or PY? → MODERATE
│   │         │
│   │         Q1.2 = SN or NI? → SERIOUS
│   │
│   └─► NO (Q1.3 = Y or PY) → SERIOUS
│
Q1.1 = WN?
├─► Q1.3 = N, PN, or NI?
│   ├─► YES → Q1.2 = Y, PY, or WN?
│   │         ├─► Q1.4 = N or PN? → MODERATE
│   │         │   Q1.4 = Y or PY? → SERIOUS
│   │         │
│   │         Q1.2 = SN or NI? → SERIOUS
│   │
│   └─► NO (Q1.3 = Y or PY) → SERIOUS
│
Q1.1 = SN or NI?
├─► Q1.4 = N or PN? → SERIOUS
│   Q1.4 = Y or PY? → CRITICAL

*LOW = "Low risk of bias (except for concerns about uncontrolled 
confounding)" - uncontrolled confounding can never be fully excluded 
in observational studies.
═══════════════════════════════════════════════════════════════════
```

---

## 9.5 LLM Presentation Templates

### Per-Question Template

```
═══════════════════════════════════════════════════════════════════
DOMAIN 1, QUESTION 1.X
═══════════════════════════════════════════════════════════════════

Question: "[FULL QUESTION TEXT]"

EXTRACTED EVIDENCE:

[Relevant evidence with quotes and page references]

───────────────────────────────────────────────────────────────────
RESPONSE OPTIONS: [List applicable options]

HUMAN DECISION REQUIRED: Select response for Q1.X
═══════════════════════════════════════════════════════════════════
```

### Algorithm Result Template

```
═══════════════════════════════════════════════════════════════════
DOMAIN 1: BIAS DUE TO CONFOUNDING - ALGORITHM RESULT
═══════════════════════════════════════════════════════════════════

SIGNALLING QUESTION RESPONSES:
- Q1.1 (Controlled for important confounders): [RESPONSE]
- Q1.2 (Valid/reliable measurement):           [RESPONSE]
- Q1.3 (Post-intervention variables):          [RESPONSE]
- Q1.4 (Negative controls suggest confounding):[RESPONSE]

ALGORITHM PATHWAY:
Q1.1 = [X] → Q1.3 = [X] → Q1.2 = [X] → Q1.4 = [X]

SUGGESTED JUDGEMENT: [LOW/MODERATE/SERIOUS/CRITICAL] RISK OF BIAS

───────────────────────────────────────────────────────────────────
HUMAN ACTION REQUIRED:

[ ] CONFIRM the suggested judgement
[ ] OVERRIDE with different judgement

If overriding, provide justification: _______________
═══════════════════════════════════════════════════════════════════
```

### Summary Box Template

```
═══════════════════════════════════════════════════════════════════
DOMAIN 1: BIAS DUE TO CONFOUNDING - COMPLETE
═══════════════════════════════════════════════════════════════════

Study: [STUDY ID]
Result: [FROM A1]
Variant: A (ITT - baseline confounding only)

SIGNALLING QUESTIONS:
Q1.1: [RESPONSE]
Q1.2: [RESPONSE]
Q1.3: [RESPONSE]
Q1.4: [RESPONSE]

RISK OF BIAS JUDGEMENT: [JUDGEMENT]
Algorithm-derived: [Yes/No]
Override justification: [If applicable]

KEY EVIDENCE:
- [Quote 1, page]
- [Quote 2, page]

───────────────────────────────────────────────────────────────────
Proceed to: Domain 2

HUMAN CONFIRMATION REQUIRED.
═══════════════════════════════════════════════════════════════════
```

---

**END OF PART C**

*Continue to Part D: Domains 2-3*
# ROBINS-I V2 LLM Reference Guide - Part D

# 10. DOMAIN 2: BIAS IN CLASSIFICATION OF INTERVENTIONS

## 10.1 Overview

**Focus**: Misclassification of intervention strategies and immortal time bias  
**Output**: Domain 2 risk of bias judgement

## 10.2 Key Concepts [Guidance Note 12]

**Misclassification bias**: Bias from misclassifying intervention strategies.

**Immortal time bias** (Type 1): Arises when intervention and comparator cannot be distinguished at follow-up start. Makes it difficult to know which strategy participants were following.

**Differential misclassification**: Related to outcomes - generally more serious.

**Non-differential misclassification**: Unrelated to outcomes - often biases toward null.

---

## 10.3 Signalling Questions

### Question 2.1

**"Were the intervention strategies distinguishable at the time when follow-up would have started in the target trial?"**

| Code | Meaning |
|------|---------|
| Y | Yes |
| PY | Probably Yes |
| PN | Probably No |
| N | No |
| NI | No Information |

**Example**: For "Surgery within 6 months" vs "Delay until progression", patients without surgery or progression are following BOTH strategies until 6 months - strategies not distinguishable at diagnosis.

**LLM Task**: When did follow-up start? How were participants classified? Could both strategies apply to same person at start?

---

### Question 2.2

**Conditional**: Only if Q2.1 = N, PN, or NI

**"Did all or nearly all outcome events occur after the intervention and comparator strategies could be distinguished?"**

| Code | Meaning |
|------|---------|
| NA | Not Applicable |
| Y/PY | Yes - limits bias risk |
| PN/N/NI | No - proceed to Q2.3 |

**LLM Task**: Period when indistinguishable vs total follow-up; when did most events occur?

---

### Question 2.3

**Conditional**: Only if Q2.2 = N, PN, or NI

**"Did the analysis avoid problems arising from intervention strategies that are not distinguishable at the start of follow-up?"**

| Code | Meaning |
|------|---------|
| NA | Not Applicable |
| SY | Yes, fully (clone-censor-weight, g-formula, landmark with proper adjustment) |
| WY | Yes, partially (appropriate methods but incomplete adjustment) |
| PN/N | No |
| NI | No Information |

**LLM Task**: Clone-censor-weighting, g-formula, landmark analysis, IPW for treatment during follow-up.

---

### Question 2.4

**"Was classification of intervention status influenced by knowledge of the outcome or risk of the outcome?"**

| Code | Meaning |
|------|---------|
| SY | Yes, substantial impact |
| WY | Yes, not substantial |
| PN | Probably No |
| N | No |
| NI | No Information |

**Differential misclassification** arises if outcome or outcome risk influences classification.

Less likely if classification from sources recorded at/before intervention start.

**LLM Task**: Data sources for classification; timing of data collection; could outcome affect data availability?

---

### Question 2.5

**"Were further classification errors (not influenced by knowledge of the outcome or risk of the outcome) likely?"**

| Code | Meaning |
|------|---------|
| Y | Yes |
| PY | Probably Yes |
| PN | Probably No |
| N | No |
| NI | No Information |

**Non-differential misclassification** - usually biases toward null.

**LLM Task**: Intervention definition clarity; data source reliability; potential for misclassification in either direction.

---

## 10.4 Domain 2 Algorithm

```
DOMAIN 2 ALGORITHM
═══════════════════════════════════════════════════════════════════

Q2.1 = Y or PY (strategies distinguishable)?
├─► Q2.4 = N or PN?
│   ├─► Q2.5 = N or PN? → LOW
│   │   Q2.5 = Y, PY, or NI? → MODERATE
│   │
│   Q2.4 = WY or NI? → MODERATE
│   Q2.4 = SY? → SERIOUS

Q2.1 = N, PN, or NI (NOT distinguishable)?
├─► Q2.2 = Y or PY (events after distinguishable)?
│   └─► [Same pathway as Q2.1 = Y/PY above]
│
├─► Q2.2 = N, PN, or NI?
│   └─► Q2.3 = SY (fully avoided)?
│       └─► [Same pathway as Q2.1 = Y/PY above]
│       
│       Q2.3 = WY or NI?
│       └─► Q2.4 = N or PN?
│           ├─► Q2.5 any → SERIOUS
│           Q2.4 = WY, NI, or SY → SERIOUS
│       
│       Q2.3 = N or PN?
│       └─► Q2.4 = N or PN? → SERIOUS
│           Q2.4 = SY, WY, or NI? → CRITICAL
═══════════════════════════════════════════════════════════════════
```

## 10.5 Summary Box Template

```
═══════════════════════════════════════════════════════════════════
DOMAIN 2: BIAS IN CLASSIFICATION OF INTERVENTIONS - COMPLETE
═══════════════════════════════════════════════════════════════════

SIGNALLING QUESTIONS:
Q2.1 (Strategies distinguishable):         [RESPONSE]
Q2.2 (Events after distinguishable):       [RESPONSE]
Q2.3 (Appropriate analysis):               [RESPONSE]
Q2.4 (Classification ~ outcome):           [RESPONSE]
Q2.5 (Further classification errors):      [RESPONSE]

RISK OF BIAS JUDGEMENT: [JUDGEMENT]

───────────────────────────────────────────────────────────────────
Proceed to: Domain 3
═══════════════════════════════════════════════════════════════════
```

---

# 11. DOMAIN 3: BIAS IN SELECTION OF PARTICIPANTS

## 11.1 Overview

**Focus**: Selection biases from excluding participants, follow-up, or events based on post-intervention characteristics  
**Output**: Domain 3 risk of bias judgement

## 11.2 Key Concepts [Guidance Note 13]

**Selection bias**: Arises from "conditioning on a common effect of intervention and outcome."

**Conditioning** happens when:
- Analysis restricted to certain variable values
- Variable included in regression model

**Classic example**: Folic acid and neural tube defects restricted to live births. Both folic acid AND defects affect live birth probability - creates bias.

**Two types in ROBINS-I**:
- Domain 3: Selection based on post-intervention characteristics
- Domain 4: Selection from missing data

**Immortal time (Type 2)**: Different from Domain 2. Occurs when follow-up doesn't begin at intervention start (prevalent user bias) or early events excluded.

---

## 11.3 Signalling Questions - Section A (Prevalent User Bias)

### Question 3.1

**"Did follow up in the analysis begin at the start of the intervention strategies being compared?"**

| Code | Meaning |
|------|---------|
| Y | Yes |
| PY | Probably Yes |
| WN | No, but bias not substantial |
| SN | No, leading to substantial bias |
| NI | No Information |

**Prevalent user bias**: "Landmark" analyses where follow-up starts AFTER intervention start:
- Follow-up that would have been observed is missing
- Participants with early outcomes are missing

Answer **SN** if:
- Effect likely differs between excluded and included periods, OR
- Substantial proportion of follow-up/outcomes excluded

**LLM Task**: When did follow-up start vs intervention start? Prevalent vs incident users?

---

### Question 3.2

**Conditional**: Only if Q3.1 = Y or PY

**"Were outcome events during a period of follow-up after the start of the interventions excluded from the analysis?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - creates immortal time |
| PN/N | No |
| NI | No Information |

**LLM Task**: Any exclusion period? Grace period? Early events excluded?

---

## 11.4 Signalling Questions - Section B (Other Selection Bias)

### Question 3.3

**"Was selection of participants into the study (or into the analysis) based on participant characteristics observed after the start of intervention?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - proceed to Q3.4 |
| PN/N | No - Section B = Low |
| NI | No Information |

**Note**: Does NOT address missing data exclusions (Domain 4).

**LLM Task**: Were any inclusion/exclusion criteria based on post-intervention characteristics?

---

### Question 3.4

**Conditional**: Only if Q3.3 = Y or PY

**"Were the post-intervention variables that influenced selection likely to be associated with intervention?"**

| Code | Meaning |
|------|---------|
| NA | Not Applicable |
| Y/PY | Yes - proceed to Q3.5 |
| PN/N | No - Section B = Low |
| NI | No Information |

---

### Question 3.5

**Conditional**: Only if Q3.4 = Y or PY

**"Were the post-intervention variables that influenced selection likely to be influenced by the outcome or a cause of the outcome?"**

| Code | Meaning |
|------|---------|
| NA | Not Applicable |
| Y/PY | Yes - Selection bias present |
| PN/N | No - Section B = Low |
| NI | No Information |

**Key concept**: If selection variable associated with BOTH intervention (Q3.4) AND outcome (Q3.5), selection bias is present.

---

## 11.5 Signalling Questions - Section C (Correction/Severity)

### Question 3.6

**Conditional**: Only if Q3.1 = SN OR Q3.5 = Y/PY

**"Is it likely that the analysis corrected for all of the potential selection biases identified above?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - reduces to Moderate |
| PN/N/NI | No - proceed to Q3.7 |

**Methods**: IPW, modeling missing follow-up distributions.

---

### Question 3.7

**Conditional**: Only if Q3.6 = N, PN, or NI

**"Did sensitivity analyses demonstrate that the likely impact of the potential selection biases identified above was minimal?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - reduces to Moderate |
| PN/N/NI | No - proceed to Q3.8 |

---

### Question 3.8

**Conditional**: Only if Q3.7 = N, PN, or NI

**"Were potential selection biases identified above sufficiently severe that the result should not be included in a quantitative synthesis?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes → CRITICAL |
| PN/N/NI | No → SERIOUS |

---

## 11.6 Domain 3 Algorithm

```
DOMAIN 3 ALGORITHM
═══════════════════════════════════════════════════════════════════

SECTION A (Q3.1, Q3.2):
Q3.1 = Y/PY → Q3.2 = N/PN/NI? → Section A = LOW
              Q3.2 = Y/PY? → Section A = MODERATE
Q3.1 = WN or NI → Section A = MODERATE
Q3.1 = SN → Section A = SERIOUS

SECTION B (Q3.3, Q3.4, Q3.5):
Q3.3 = N/PN → Section B = LOW
Q3.3 = NI → Section B = MODERATE
Q3.3 = Y/PY → Q3.4 = N/PN? → Section B = LOW
              Q3.4 = NI? → Section B = MODERATE
              Q3.4 = Y/PY → Q3.5 = N/PN? → Section B = LOW
                            Q3.5 = NI? → Section B = MODERATE
                            Q3.5 = Y/PY → Section B = SERIOUS

COMBINE SECTIONS:
Both LOW → LOW
At worst MODERATE → MODERATE
At least one SERIOUS → Check Q3.6-3.8:
  Q3.6 = Y/PY → MODERATE
  Q3.6 = N/PN/NI → Q3.7 = Y/PY → MODERATE
                   Q3.7 = N/PN/NI → Q3.8 = Y/PY → CRITICAL
                                    Q3.8 = N/PN/NI → SERIOUS
═══════════════════════════════════════════════════════════════════
```

## 11.7 Summary Box Template

```
═══════════════════════════════════════════════════════════════════
DOMAIN 3: BIAS IN SELECTION OF PARTICIPANTS - COMPLETE
═══════════════════════════════════════════════════════════════════

SECTION A:
Q3.1 (Follow-up at intervention start): [RESPONSE]
Q3.2 (Early events excluded):           [RESPONSE]
Section A Result: [LOW/MODERATE/SERIOUS]

SECTION B:
Q3.3 (Post-intervention selection):     [RESPONSE]
Q3.4 (Selection ~ intervention):        [RESPONSE]
Q3.5 (Selection ~ outcome):             [RESPONSE]
Section B Result: [LOW/MODERATE/SERIOUS]

SECTION C (if applicable):
Q3.6 (Analysis corrected):              [RESPONSE]
Q3.7 (Sensitivity analyses):            [RESPONSE]
Q3.8 (Severe enough to exclude):        [RESPONSE]

RISK OF BIAS JUDGEMENT: [JUDGEMENT]

───────────────────────────────────────────────────────────────────
Proceed to: Domain 4
═══════════════════════════════════════════════════════════════════
```

---

**END OF PART D**

*Continue to Part E: Domains 4-5*
# ROBINS-I V2 LLM Reference Guide - Part E

# 12. DOMAIN 4: BIAS DUE TO MISSING DATA

## 12.1 Overview

**Focus**: Bias from missing outcome, intervention, or confounder data  
**Output**: Domain 4 risk of bias judgement

## 12.2 Key Concepts [Guidance Note 14]

**Sources of missing data**:
- Attrition / loss to follow-up
- Missed appointments
- Incomplete data collection
- Missing intervention/confounder data

**No single threshold**: 95% complete may still be biased if outcome rare AND missingness related to intervention group.

**Analysis types**:
1. **Complete case**: Restricted to those with complete data
2. **Imputation**: Estimated values for missing data
3. **Other**: IPW, FIML

## 12.3 Missing Data Categories (Little & Rubin)

| Category | Definition | Example |
|----------|------------|---------|
| **MCAR** | No systematic differences between missing and observed | Equipment breakdown |
| **MAR** | Differences explained by observed data | Younger people more likely missing, and have lower values |
| **MNAR** | Differences remain after accounting for observed | High values cause missingness (e.g., high BP → headaches → missed appointments) |

**Key**: Multiple imputation avoids bias if MAR/MCAR, but NOT if MNAR.

---

## 12.4 Signalling Questions

### Questions 4.1, 4.2, 4.3 (Data Completeness)

**Q4.1**: "Were complete data on intervention status available for all, or nearly all, participants?"

**Q4.2**: "Were complete data on the outcome available for all, or nearly all, participants?"

**Q4.3**: "Were complete data on important confounding variables available for all, or nearly all, participants?"

| Code | Meaning |
|------|---------|
| Y/PY | Yes - nearly all complete |
| PN/N | No |
| NI | No Information |

**"Nearly all"** = so few missing they couldn't importantly affect results.

**For dichotomous outcomes**: Compare event count to missing count. If events >> missing, bias limited.

**LLM Task**: Flow diagram, missing data reports, sample sizes at each stage.

---

### Question 4.4

**Conditional**: Only if any of Q4.1-4.3 = N, PN, or NI

**"Is the result based on a complete case analysis?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - complete case |
| PN/N | No - check if imputation |
| NI | No Information |

**Complete case** = restricted to those with complete data on ALL intervention, outcome, AND confounders.

---

### Question 4.5

**Conditional**: Only if Q4.4 = Y, PY, or NI

**"Was exclusion from the analysis because of missing data likely to be related to the true value of the outcome?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - biased complete case analysis |
| PN/N | No |
| NI | No Information |

**Answer Y/PY if**:
1. Different % excluded between intervention groups
2. Different % excluded between outcome groups
3. Reasons suggest missingness depends on outcome
4. Circumstances suggest missingness depends on outcome (e.g., severe depression → missed appointments)

---

### Question 4.6

**Conditional**: Only if Q4.5 = Y, PY, or NI

**"Is the relationship between the outcome and missingness likely to be explained by the variables in the analysis model?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - variables explaining missingness are in model |
| WN | No, but not substantial bias |
| SN | No, substantial bias |
| NI | No Information |

---

### Question 4.7

**Conditional**: Only if Q4.4 = N or PN

**"Was the analysis based on imputing missing values?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - single or multiple imputation |
| PN/N/NI | No - check alternative methods |

---

### Question 4.8

**Conditional**: Only if Q4.7 = Y or PY

**"Is it reasonable to assume that data were 'missing at random' (MAR) or 'missing completely at random' (MCAR)?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - MAR/MCAR reasonable |
| PN/N | No - evidence of MNAR |
| NI | No Information |

Answer N/PN only if evidence suggests MNAR.

---

### Question 4.9

**Conditional**: Only if Q4.8 = Y or PY

**"Was imputation performed appropriately?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - proper MI with all relevant variables |
| WN | No, but not substantial bias (e.g., simple imputation with low missingness) |
| SN | No, substantial bias |
| NI | No Information |

**For MI**: All predictors of missingness AND all analysis variables should be in imputation model.

**Simple imputation** (LOCF, mean): Answer WN or SN.

---

### Question 4.10

**Conditional**: Only if Q4.7 = N, PN, or NI

**"Was an appropriate alternative method used to correct for bias due to missing data?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - IPW, FIML, etc. |
| WN/SN | No |
| NI | No Information |

---

### Question 4.11

**Conditional**: Complex - see algorithm

**"Is there evidence that the result was not biased by missing data?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - sensitivity analyses show robustness |
| PN/N | No |

---

## 12.5 Domain 4 Algorithm

```
DOMAIN 4 ALGORITHM
═══════════════════════════════════════════════════════════════════

ALL of Q4.1, Q4.2, Q4.3 = Y/PY?
└─► LOW RISK

ANY of Q4.1, Q4.2, Q4.3 = N/PN/NI?
└─► Q4.4 = Y/PY/NI (complete case)?
    └─► Q4.5 = N/PN?
        └─► Q4.11 → Y/PY? MODERATE | N/PN? SERIOUS
        
        Q4.5 = Y/PY/NI?
        └─► Q4.6 = Y/PY? → MODERATE
            Q4.6 = WN/NI? → MODERATE
            Q4.6 = SN? → Q4.11 → Y/PY? SERIOUS | N/PN? SERIOUS
    
    Q4.4 = N/PN (not complete case)?
    └─► Q4.7 = Y/PY (imputation)?
        └─► Q4.8 = Y/PY (MAR/MCAR)?
            └─► Q4.9 = Y/PY? → LOW
                Q4.9 = WN/NI? → MODERATE
                Q4.9 = SN? → Q4.11 → Y/PY? SERIOUS | N/PN? CRITICAL
            
            Q4.8 = N/PN/NI?
            └─► Q4.11 → Y/PY? MODERATE | N/PN? SERIOUS
        
        Q4.7 = N/PN/NI (other method)?
        └─► Q4.10 = Y/PY? → LOW
            Q4.10 = WN/NI? → Q4.11 → Y/PY? MODERATE | N/PN? SERIOUS
            Q4.10 = SN? → Q4.11 → Y/PY? SERIOUS | N/PN? CRITICAL
═══════════════════════════════════════════════════════════════════
```

## 12.6 Summary Box Template

```
═══════════════════════════════════════════════════════════════════
DOMAIN 4: BIAS DUE TO MISSING DATA - COMPLETE
═══════════════════════════════════════════════════════════════════

DATA COMPLETENESS:
Q4.1 (Intervention data):   [RESPONSE]
Q4.2 (Outcome data):        [RESPONSE]
Q4.3 (Confounder data):     [RESPONSE]

ANALYSIS PATH:
Q4.4 (Complete case):       [RESPONSE]
Q4.5-4.6 OR Q4.7-4.10:      [As applicable]
Q4.11 (Evidence not biased):[RESPONSE]

RISK OF BIAS JUDGEMENT: [JUDGEMENT]

───────────────────────────────────────────────────────────────────
Proceed to: Domain 5
═══════════════════════════════════════════════════════════════════
```

---

# 13. DOMAIN 5: BIAS IN MEASUREMENT OF THE OUTCOME

## 13.1 Overview

**Focus**: Misclassification or measurement error of outcomes  
**Output**: Domain 5 risk of bias judgement

## 13.2 Key Concepts [Guidance Note 15]

| Type | Definition | Effect |
|------|------------|--------|
| **Non-differential** | Unrelated to intervention | Random: reduces precision. Systematic: no bias |
| **Differential** | Related to intervention | Biases intervention-outcome relationship (detection bias) |

**Detection bias**: Common differential measurement error. Arises when:
1. Outcome assessors aware of intervention (especially for subjective outcomes)
2. Different observation methods/intensity between groups
3. Measurement errors related to intervention

**Blinding**: Prevents systematic measurement differences. Often not possible in observational studies.

---

## 13.3 Signalling Questions

### Question 5.1

**"Could measurement or ascertainment of the outcome have differed between intervention groups?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - proceed, likely Serious |
| PN/N | No |
| NI | No Information |

**Differences may arise from**:
- Diagnostic detection bias (intervention → more healthcare contacts → more detection)
- Additional visits with intervention

**LLM Task**: Same measurement method? Same time points? Differential healthcare contacts?

---

### Question 5.2

**"Were outcome assessors aware of the intervention received by study participants?"**

| Code | Meaning |
|------|---------|
| Y | Yes |
| PY | Probably Yes |
| PN | Probably No |
| N | No (blinded or unaware) |
| NI | No Information |

**Note**: When participants report own outcomes (questionnaire), the assessor IS the participant. In observational studies, answer usually Y for self-report.

**LLM Task**: Who assessed? Blinding? Self-reported?

---

### Question 5.3

**Conditional**: Only if Q5.2 = Y, PY, or NI

**"Could assessment of the outcome have been influenced by knowledge of the intervention received?"**

| Code | Meaning |
|------|---------|
| SY | Yes, to a large extent |
| WY | Yes, to a small extent |
| PN | Probably No |
| N | No |
| NI | No Information |

**Knowledge COULD influence**:
- Patient-reported outcomes (pain, symptoms)
- Observer-reported outcomes involving judgement
- Provider decision outcomes

**Knowledge UNLIKELY to influence**:
- Observer-reported outcomes without judgement (all-cause mortality)
- Laboratory measures

**Distinguishing SY vs WY**:
- **SY**: Strong beliefs/preferences make influence LIKELY (e.g., symptoms in homeopathy study)
- **WY**: Influence possible but no reason to think it occurred

---

## 13.4 Domain 5 Algorithm

```
DOMAIN 5 ALGORITHM
═══════════════════════════════════════════════════════════════════

Q5.1 = N/PN (measurement same)?
└─► Q5.2 = N/PN? → LOW
    Q5.2 = Y/PY/NI?
    └─► Q5.3 = N/PN? → LOW
        Q5.3 = WY/NI? → MODERATE
        Q5.3 = SY? → MODERATE

Q5.1 = NI?
└─► Q5.2 = N/PN? → LOW
    Q5.2 = Y/PY/NI?
    └─► Q5.3 = WY/N/PN/NI? → MODERATE
        Q5.3 = SY? → SERIOUS

Q5.1 = Y/PY (measurement differed)?
└─► SERIOUS
═══════════════════════════════════════════════════════════════════
```

## 13.5 Summary Box Template

```
═══════════════════════════════════════════════════════════════════
DOMAIN 5: BIAS IN MEASUREMENT OF OUTCOME - COMPLETE
═══════════════════════════════════════════════════════════════════

SIGNALLING QUESTIONS:
Q5.1 (Measurement differ between groups): [RESPONSE]
Q5.2 (Assessors aware of intervention):   [RESPONSE]
Q5.3 (Knowledge could influence):         [RESPONSE]

RISK OF BIAS JUDGEMENT: [JUDGEMENT]

───────────────────────────────────────────────────────────────────
Proceed to: Domain 6
═══════════════════════════════════════════════════════════════════
```

---

**END OF PART E**

*Continue to Part F: Domain 6, Overall, and Audit Log*
# ROBINS-I V2 LLM Reference Guide - Part F

# 14. DOMAIN 6: BIAS IN SELECTION OF THE REPORTED RESULT

## 14.1 Overview

**Focus**: Selective reporting based on statistical significance or direction  
**Output**: Domain 6 risk of bias judgement

## 14.2 Key Concepts [Guidance Note 16]

**Types of selective reporting**:

| Type | Description |
|------|-------------|
| **Selective outcome reporting** | Result selected from multiple measurements (scales, definitions, time points) |
| **Selective analysis reporting** | Result selected from multiple analytical approaches |
| **Subgroup selection** | Cohort selected based on more interesting findings |

**Motivations**: Newsworthy findings, commercial interests, desire to show no harm.

**Best protection**: Pre-specified, publicly available analysis plan matching reported results.

**Note**: Protocols for non-randomized studies increasingly registered, but detailed analysis plans rarely available. Compare Methods and Results for clues.

---

## 14.3 Signalling Questions

### Question 6.1

**"Was the result reported in accordance with an available, pre-determined analysis plan?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes → LOW risk |
| PN/N/NI | No/Unknown → Assess Q6.2-6.4 |

Finalization must PRECEDE availability of unblinded outcome data.

**Note**: Such plans are **rarely available** for observational studies, so most will not achieve Low risk here.

**LLM Task**: Protocol reference? Registry record? Comparison of stated plans vs reported results?

---

### Questions 6.2, 6.3, 6.4 (Selection Assessment)

**If Q6.1 = N, PN, or NI, answer all three:**

### Question 6.2

**"Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple outcome measurements within the outcome domain?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes - evidence of selection |
| PN/N | No |
| NI | No Information |

**Answer Y/PY if**:
- Multiple measurements made but only subset reported without justification
- Selection likely based on results (statistical significance)

**Answer N/PN if**:
- All reported results match all intended measurements
- Only one possible way to measure outcome domain

**LLM Task**: Multiple outcome measurements in Methods? Which reported in Results? Discrepancies?

---

### Question 6.3

**"Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple analyses of the data?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes |
| PN/N | No |
| NI | No Information |

**Multiple analyses may arise from**:
- Unadjusted vs adjusted models
- Final value vs change vs ANCOVA
- Different intervention/control definitions
- Variable transformations
- Different cut-points
- Different covariate sets
- Different missing data strategies

**LLM Task**: Multiple analytical approaches mentioned? Both adjusted and unadjusted reported?

---

### Question 6.4

**"Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple subgroups?"**

| Code | Meaning |
|------|---------|
| Y/PY | Yes |
| PN/N | No |
| NI | No Information |

**Red flags**:
- Unusual subgroup definitions
- Results for unexpected subgroups

**LLM Task**: Subgroup analyses? Pre-specified? Unusual categorizations?

---

## 14.4 Domain 6 Algorithm

```
DOMAIN 6 ALGORITHM
═══════════════════════════════════════════════════════════════════

Q6.1 = Y/PY (per pre-determined plan)?
└─► LOW RISK

Q6.1 = N/PN/NI?
└─► Assess Q6.2, Q6.3, Q6.4

    Count across Q6.2-6.4:
    
    ALL three = N/PN?
    └─► MODERATE
    
    At least one NI, but NO Y/PY?
    └─► MODERATE
    
    Exactly ONE = Y/PY (or all three = NI)?
    └─► SERIOUS
    
    TWO OR MORE = Y/PY?
    └─► CRITICAL
═══════════════════════════════════════════════════════════════════
```

## 14.5 Summary Box Template

```
═══════════════════════════════════════════════════════════════════
DOMAIN 6: BIAS IN SELECTION OF REPORTED RESULT - COMPLETE
═══════════════════════════════════════════════════════════════════

SIGNALLING QUESTIONS:
Q6.1 (Per pre-determined plan):     [RESPONSE]
Q6.2 (Multiple measurements):       [RESPONSE]
Q6.3 (Multiple analyses):           [RESPONSE]
Q6.4 (Multiple subgroups):          [RESPONSE]

Y/PY count (Q6.2-6.4): [N]

RISK OF BIAS JUDGEMENT: [JUDGEMENT]

───────────────────────────────────────────────────────────────────
ALL DOMAINS COMPLETE. Proceed to: Overall Risk of Bias
═══════════════════════════════════════════════════════════════════
```

---

# 15. OVERALL RISK OF BIAS

## 15.1 Overview

**When**: After all six domains complete  
**Purpose**: Integrate domain judgements into single overall judgement

## 15.2 Key Concept [Guidance Note 17]

ROBINS-I defaults to **worst domain judgement = overall judgement**.

**However**, user may override to judge greater risk if problems in **several domains** compound. For example, several Serious domains may justify Critical overall.

## 15.3 Overall Algorithm

```
OVERALL RISK OF BIAS ALGORITHM
═══════════════════════════════════════════════════════════════════

WORST DOMAIN = LOW (all domains Low)?
└─► OVERALL = LOW* 
    (*"except for concerns about uncontrolled confounding")
    Interpretation: Possibility of uncontrolled confounding given 
    observational nature, but otherwise little concern.

WORST DOMAIN = MODERATE (no Serious/Critical)?
└─► OVERALL = MODERATE
    Interpretation: Some concern, but not clear important risk.
    
    Consider: Multiple Moderate domains → may override to SERIOUS

WORST DOMAIN = SERIOUS (no Critical)?
└─► OVERALL = SERIOUS
    Interpretation: Important problems giving rise to serious risk.
    
    Consider: Multiple Serious domains → may override to CRITICAL

ANY DOMAIN = CRITICAL?
└─► OVERALL = CRITICAL
    Interpretation: Very problematic; should generally be excluded 
    from evidence syntheses.
═══════════════════════════════════════════════════════════════════
```

## 15.4 LLM Presentation Template

```
═══════════════════════════════════════════════════════════════════
OVERALL RISK OF BIAS - ALGORITHM RESULT
═══════════════════════════════════════════════════════════════════

Study: [STUDY ID]
Result: [FROM A1]
Outcome: [FROM A3]

DOMAIN-LEVEL JUDGEMENTS:

| Domain | Judgement |
|--------|-----------|
| 1. Confounding | [JUDGEMENT] |
| 2. Classification of Interventions | [JUDGEMENT] |
| 3. Selection of Participants | [JUDGEMENT] |
| 4. Missing Data | [JUDGEMENT] |
| 5. Measurement of Outcome | [JUDGEMENT] |
| 6. Selection of Reported Result | [JUDGEMENT] |

WORST DOMAIN: [JUDGEMENT] (Domain [N])

ADDITIONAL CONSIDERATIONS:
- Multiple Serious domains? [Yes/No]
- Multiple Moderate domains? [Yes/No]
- Compounding effects likely? [Assessment]

───────────────────────────────────────────────────────────────────
SUGGESTED OVERALL JUDGEMENT: [JUDGEMENT]

HUMAN ACTION REQUIRED:
[ ] CONFIRM overall judgement
[ ] OVERRIDE (if compounding effects warrant higher risk)

If overriding, justification: _______________
═══════════════════════════════════════════════════════════════════
```

## 15.5 Final Assessment Summary Template

```
═══════════════════════════════════════════════════════════════════
ROBINS-I V2 ASSESSMENT COMPLETE
═══════════════════════════════════════════════════════════════════

STUDY INFORMATION:
Study: [STUDY ID]
Result: [FROM A1]
Outcome: [FROM A3]

TARGET TRIAL:
Participants: [FROM C1]
Intervention: [FROM C2]
Comparator: [FROM C3]
Effect type: ITT

INFORMATION SOURCES:
[List from Section D]

═══════════════════════════════════════════════════════════════════

RISK OF BIAS SUMMARY:

| Domain | Judgement |
|--------|-----------|
| 1. Confounding | [JUDGEMENT] |
| 2. Classification of Interventions | [JUDGEMENT] |
| 3. Selection of Participants | [JUDGEMENT] |
| 4. Missing Data | [JUDGEMENT] |
| 5. Measurement of Outcome | [JUDGEMENT] |
| 6. Selection of Reported Result | [JUDGEMENT] |
|--------|-----------|
| **OVERALL** | **[JUDGEMENT]** |

═══════════════════════════════════════════════════════════════════

Assessment completed: [DATE]
Confirmed by: [REVIEWER]

Proceed to: Generate Audit Log
═══════════════════════════════════════════════════════════════════
```

---

# 16. END-OF-ASSESSMENT AUDIT LOG

## 16.1 Purpose

Complete record for reproducibility and transparency.

## 16.2 Audit Log Template

```
═══════════════════════════════════════════════════════════════════
ROBINS-I V2 ASSESSMENT AUDIT LOG
═══════════════════════════════════════════════════════════════════

ASSESSMENT METADATA
───────────────────────────────────────────────────────────────────
Study identifier: [STUDY ID]
Result assessed: [FROM A1]
Outcome: [FROM A3]
Assessment date: [DATE]
Reviewer(s): [NAMES]
LLM Assistant: [MODEL/VERSION]

PROJECT CONTEXT
───────────────────────────────────────────────────────────────────
Project: [PROJECT NAME]
P1 Confounding factors: [LIST]

INFORMATION SOURCES
───────────────────────────────────────────────────────────────────
[List all sources with citations]

═══════════════════════════════════════════════════════════════════
PRELIM STAGE RECORD
═══════════════════════════════════════════════════════════════════

SECTION A: RESULT SPECIFICATION
A1: [RESPONSE]
A2: [RESPONSE]
A3: [RESPONSE]

SECTION B: TRIAGE
B1: [RESPONSE] | Evidence: [Quote, page]
B2: [RESPONSE] | Evidence: [Quote, page]
B3: [RESPONSE] | Evidence: [Quote, page]

SECTION C: TARGET TRIAL
C1: [RESPONSE] | Evidence: [Quote, page]
C2: [RESPONSE] | Evidence: [Quote, page]
C3: [RESPONSE] | Evidence: [Quote, page]
C4: No (ITT)

═══════════════════════════════════════════════════════════════════
CONFOUNDING FACTOR EVALUATION RECORD
═══════════════════════════════════════════════════════════════════

| Factor | Variable(s) | Controlled? | Valid/Reliable? | Unnecessary? |
|--------|-------------|-------------|-----------------|--------------|
| [F1] | [Vars] | [Y/N] | [Response] | [Response] |
| [F2] | [Vars] | [Y/N] | [Response] | [Response] |

Key evidence: [Quotes with pages]

═══════════════════════════════════════════════════════════════════
DOMAIN 1: BIAS DUE TO CONFOUNDING
═══════════════════════════════════════════════════════════════════
Q1.1: [RESPONSE] | Evidence: [Quote, page]
Q1.2: [RESPONSE] | Evidence: [Quote, page]
Q1.3: [RESPONSE] | Evidence: [Quote, page]
Q1.4: [RESPONSE] | Evidence: [Quote, page]

Algorithm result: [JUDGEMENT]
Final judgement: [JUDGEMENT]
Override: [Yes/No] | Justification: [If applicable]

═══════════════════════════════════════════════════════════════════
DOMAIN 2: BIAS IN CLASSIFICATION OF INTERVENTIONS
═══════════════════════════════════════════════════════════════════
Q2.1: [RESPONSE] | Evidence: [Quote, page]
Q2.2: [RESPONSE] | Evidence: [Quote, page]
Q2.3: [RESPONSE] | Evidence: [Quote, page]
Q2.4: [RESPONSE] | Evidence: [Quote, page]
Q2.5: [RESPONSE] | Evidence: [Quote, page]

Algorithm result: [JUDGEMENT]
Final judgement: [JUDGEMENT]
Override: [Yes/No] | Justification: [If applicable]

═══════════════════════════════════════════════════════════════════
DOMAIN 3: BIAS IN SELECTION OF PARTICIPANTS
═══════════════════════════════════════════════════════════════════
Q3.1: [RESPONSE] | Evidence: [Quote, page]
Q3.2: [RESPONSE] | Evidence: [Quote, page]
Q3.3: [RESPONSE] | Evidence: [Quote, page]
Q3.4: [RESPONSE] | Evidence: [Quote, page]
Q3.5: [RESPONSE] | Evidence: [Quote, page]
Q3.6: [RESPONSE] | Evidence: [Quote, page]
Q3.7: [RESPONSE] | Evidence: [Quote, page]
Q3.8: [RESPONSE] | Evidence: [Quote, page]

Algorithm result: [JUDGEMENT]
Final judgement: [JUDGEMENT]
Override: [Yes/No] | Justification: [If applicable]

═══════════════════════════════════════════════════════════════════
DOMAIN 4: BIAS DUE TO MISSING DATA
═══════════════════════════════════════════════════════════════════
Q4.1: [RESPONSE] | Evidence: [Quote, page]
Q4.2: [RESPONSE] | Evidence: [Quote, page]
Q4.3: [RESPONSE] | Evidence: [Quote, page]
Q4.4: [RESPONSE] | Evidence: [Quote, page]
Q4.5: [RESPONSE] | Evidence: [Quote, page]
Q4.6: [RESPONSE] | Evidence: [Quote, page]
Q4.7: [RESPONSE] | Evidence: [Quote, page]
Q4.8: [RESPONSE] | Evidence: [Quote, page]
Q4.9: [RESPONSE] | Evidence: [Quote, page]
Q4.10: [RESPONSE] | Evidence: [Quote, page]
Q4.11: [RESPONSE] | Evidence: [Quote, page]

Algorithm result: [JUDGEMENT]
Final judgement: [JUDGEMENT]
Override: [Yes/No] | Justification: [If applicable]

═══════════════════════════════════════════════════════════════════
DOMAIN 5: BIAS IN MEASUREMENT OF OUTCOME
═══════════════════════════════════════════════════════════════════
Q5.1: [RESPONSE] | Evidence: [Quote, page]
Q5.2: [RESPONSE] | Evidence: [Quote, page]
Q5.3: [RESPONSE] | Evidence: [Quote, page]

Algorithm result: [JUDGEMENT]
Final judgement: [JUDGEMENT]
Override: [Yes/No] | Justification: [If applicable]

═══════════════════════════════════════════════════════════════════
DOMAIN 6: BIAS IN SELECTION OF REPORTED RESULT
═══════════════════════════════════════════════════════════════════
Q6.1: [RESPONSE] | Evidence: [Quote, page]
Q6.2: [RESPONSE] | Evidence: [Quote, page]
Q6.3: [RESPONSE] | Evidence: [Quote, page]
Q6.4: [RESPONSE] | Evidence: [Quote, page]

Algorithm result: [JUDGEMENT]
Final judgement: [JUDGEMENT]
Override: [Yes/No] | Justification: [If applicable]

═══════════════════════════════════════════════════════════════════
OVERALL RISK OF BIAS
═══════════════════════════════════════════════════════════════════

| Domain | Final Judgement |
|--------|-----------------|
| 1. Confounding | [JUDGEMENT] |
| 2. Classification | [JUDGEMENT] |
| 3. Selection | [JUDGEMENT] |
| 4. Missing Data | [JUDGEMENT] |
| 5. Measurement | [JUDGEMENT] |
| 6. Reported Result | [JUDGEMENT] |
|--------|-----------------|
| **OVERALL** | **[JUDGEMENT]** |

Worst domain: [Domain N]
Override applied: [Yes/No]
Override justification: [If applicable]

═══════════════════════════════════════════════════════════════════
ASSESSMENT CERTIFICATION
═══════════════════════════════════════════════════════════════════

This assessment was conducted following ROBINS-I V2 (20 November 2025)
with LLM assistance for evidence extraction and workflow guidance.
All final judgements were made by the human reviewer(s).

Reviewer signature: _______________
Date: _______________

═══════════════════════════════════════════════════════════════════
END OF AUDIT LOG
═══════════════════════════════════════════════════════════════════
```

---

**END OF PART F**

**END OF ROBINS-I V2 LLM REFERENCE GUIDE**
