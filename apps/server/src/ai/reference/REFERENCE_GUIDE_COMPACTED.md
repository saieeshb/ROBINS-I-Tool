# ROBINS-I V2 LLM Reference Guide (Compacted)
## Interpretive Knowledge Base for LLM-Assisted Risk of Bias Assessment

**Version**: 1.0c (compacted)
**Based on**: ROBINS-I V2 (20 November 2025)
**Scope**: ITT analyses only; Domain 1 Variant A only
**Use with**: Study Session Prompt and Domain Session Prompt (which contain all operational templates and algorithms)

---

# 1. SCOPE AND ROLE

This guide provides the interpretive knowledge base. The Session Prompts contain the operational workflow, templates, and algorithms. This guide should be consulted for definitions, answer guidance, and conceptual understanding.

**Assessment scope**: ITT analyses, Domain 1 Variant A, no direction of bias predictions, audit log at end only.

**Risk of Bias Categories**:
- **Low**: Little or no concern. For Domain 1: "Low risk (except for concerns about uncontrolled confounding)"
- **Moderate**: Some concern, but not clearly important
- **Serious**: Important problems giving rise to serious risk
- **Critical**: Very problematic; exclude from syntheses

---

# 2. PLANNING: CONFOUNDING FACTORS (P1)

**Confounding Factor**: A prognostic factor (predictor of the outcome) that also predicts whether participants receive the intervention or comparator strategy.

**Important Confounding Factor**: A confounding factor with potential to introduce material bias. Factors with only very weak associations with intervention or outcome need not be considered.

**Identification guidance**: Requires content knowledge of the clinical/research domain. May be informed by relevant literature. Should be specified at the research question level.

---

# 3. PRELIM STAGE

## Section A: Specify the Result
A ROBINS-I assessment is specific to a particular study result. Different results from the same study may be at different risks of bias (e.g., unadjusted vs. adjusted estimates).

## Section B: Triage
Some characteristics lead directly to Critical risk, making detailed assessment unnecessary. If B2 = Y/PY or B3 = Y/PY, assessment terminates with CRITICAL.

**B1 answer guidance**: Search for adjustment methods, covariates, propensity scores, matching, stratification, regression with covariates.

**B2 answer guidance** (only if B1 = N/PN): Baseline imbalances, obvious prognostic differences between groups.

**B3 answer guidance**: Criteria for Y/PY: (1) important outcome values outside detectable range, (2) instrument demonstrated to have poor reliability/validity, (3) measurement method differed substantially between groups. In most circumstances, answer will be N or PN.

## Section C: Target Trial
The non-randomized study is considered as an attempt to emulate a pragmatic randomized trial (the target trial). This is hypothetical; ethics and feasibility need not be considered. Specifying it involves "reverse engineering" the research question from the analysis.

**C1 (Participants)**: Eligible participants determined by study eligibility criteria. May require careful consideration of restrictions applied.

**C2 (Intervention)**: May be point (single time, e.g. surgery) or sustained (over time, e.g. continuing drug treatment). For ITT: detailed specification over time not necessary.

**C3 (Comparator)**: Alternative active intervention, standard care, or no intervention.

**C4**: Locked to "No" (ITT). Domain 1 Variant A used; only baseline confounding assessed.

## Section D: Information Sources
Evaluation should be based on maximum available information: published articles, study protocol, unpublished reports, correspondence with investigators, registry records.

---

# 4. CONFOUNDING FACTOR EVALUATION

**Baseline Confounding**: Occurs when prognostic factors present BEFORE follow-up start predict whether participants start intervention or comparator. This is the only type assessed for ITT analyses.

**Confounding Factor vs. Measured Variable**: The confounding factor is the construct; variables are used to measure it. Variables may be imperfect measures of the underlying factor.

**When Control May Be Unnecessary**:
- **(a)** Factor not associated with outcome conditional on intervention
- **(b)** Factor not associated with intervention receipt
- **(c)** Controlling makes minimal difference to estimate
- **(d)** Addressed by design (restriction, matching in design phase)
- **(e)** Negative controls demonstrate minimal confounding
- **(f)** External evidence suggests control unnecessary

**Per-factor evaluation columns**:
- Measured variable(s): What variable(s) measured this factor?
- Controlled for? (Y/N)
- Valid/reliable measurement? (NA/Y/PY/PN/N/NI). Validity = variable accurately measures the factor. Reliability = precision of measurement.
- Control unnecessary? (NA/Y/PY/PN/N). Reference conditions (a)-(f) above.

---

# 5. DOMAIN 1: CONFOUNDING (Variant A)

**Uncontrolled confounding** may arise because: (1) confounding factors not measured, (2) variables insufficient to characterize the factor, (3) variables measured but not included in analysis.

**Appropriate control methods**: Stratification, regression, matching, standardization, inverse probability weighting, propensity score methods.

### Q1.1 Answer Guidance
"Did the authors control for all important confounding factors for which this was necessary?"
- **Y/PY**: All important confounders for which control was necessary were controlled appropriately. Also Y/PY if (rarely) no confounding factors exist.
- **WN**: Most controlled; uncontrolled factors likely highly correlated with controlled factors.
- **SN**: At least one important confounder should have been controlled but wasn't, and failure likely has material impact.

### Q1.2 Answer Guidance
"Were confounding factors controlled for measured validly and reliably?"
- Valid/reliable measures may be cited in study or listed in review protocol.
- If no indication of validity, evaluate subjectivity of measure.
- If no confounding factors (rare), answer Y/PY.

### Q1.3 Answer Guidance
"Did the authors control for any post-intervention variables that could have been affected by the intervention?"
- **Mediator**: Variable on causal pathway from intervention to outcome. Controlling estimates direct effect and may introduce bias.
- **Collider**: Common effect of intervention and outcome. Controlling introduces bias.
- List ALL variables controlled for. For each: was it measured BEFORE or AFTER intervention start? Could any be affected by intervention?

### Q1.4 Answer Guidance
"Did negative controls, bias analysis, or other considerations suggest serious uncontrolled confounding?"
- If study did NOT use negative controls and nothing else suggests confounding: answer **N**.
- Answer Y/PY if negative controls indicate material confounding bias.
- Look for: negative control outcomes/exposures, E-values, quantitative bias analyses, sensitivity analyses for unmeasured confounding, author discussion of residual confounding.

---

# 6. DOMAIN 2: CLASSIFICATION OF INTERVENTIONS

**Misclassification bias**: Bias from misclassifying intervention strategies.

**Immortal time bias (Type 1)**: Arises when intervention and comparator cannot be distinguished at follow-up start. Makes it difficult to know which strategy participants were following.

**Differential misclassification**: Related to outcomes, generally more serious.

**Non-differential misclassification**: Unrelated to outcomes, often biases toward null.

### Q2.1 Answer Guidance
"Were the intervention strategies distinguishable at the time when follow-up would have started in the target trial?"
- Example: For "Surgery within 6 months" vs "Delay until progression", patients without surgery or progression are following BOTH strategies until 6 months.
- Assess: When did follow-up start? How were participants classified? Could both strategies apply to the same person at start?

### Q2.2 Answer Guidance (if Q2.1 = N/PN/NI)
"Did all or nearly all outcome events occur after the intervention and comparator strategies could be distinguished?"
- Assess: Period when indistinguishable vs total follow-up; when did most events occur?

### Q2.3 Answer Guidance (if Q2.2 = N/PN/NI)
"Did the analysis avoid problems arising from intervention strategies not distinguishable at follow-up start?"
- **SY**: Clone-censor-weight, g-formula, landmark with proper adjustment for time-varying confounding.
- **WY**: Appropriate methods but incomplete adjustment.
- Look for: clone-censor-weighting, g-formula, landmark analysis, IPW for treatment during follow-up.

### Q2.4 Answer Guidance
"Was classification of intervention status influenced by knowledge of the outcome or risk of the outcome?"
- Differential misclassification arises if outcome or outcome risk influences classification.
- Less likely if classification from sources recorded at/before intervention start.
- Assess: Data sources for classification; timing of data collection; could outcome affect data availability?

### Q2.5 Answer Guidance
"Were further classification errors (not influenced by outcome knowledge) likely?"
- Non-differential misclassification, usually biases toward null.
- Assess: Intervention definition clarity; data source reliability; potential for misclassification in either direction.

---

# 7. DOMAIN 3: SELECTION OF PARTICIPANTS

**Selection bias**: Arises from "conditioning on a common effect of intervention and outcome."

**Conditioning** happens when: analysis restricted to certain variable values, or variable included in regression model.

**Classic example**: Folic acid and neural tube defects restricted to live births. Both folic acid AND defects affect live birth probability, creating bias.

**Immortal time (Type 2)**: Different from Domain 2. Occurs when follow-up doesn't begin at intervention start (prevalent user bias) or early events excluded.

### Q3.1 Answer Guidance (Section A: Prevalent User Bias)
"Did follow up in the analysis begin at the start of the intervention strategies being compared?"
- **Prevalent user bias**: "Landmark" analyses where follow-up starts AFTER intervention start. Follow-up that would have been observed is missing; participants with early outcomes are missing.
- Answer **SN** if: effect likely differs between excluded and included periods, OR substantial proportion of follow-up/outcomes excluded.
- Assess: When did follow-up start vs intervention start? Prevalent vs incident users?

### Q3.2 Answer Guidance (if Q3.1 = Y/PY)
"Were outcome events during a period of follow-up after the start of the interventions excluded from the analysis?"
- Look for: any exclusion period, grace period, early events excluded.

### Q3.3 Answer Guidance (Section B: Other Selection Bias)
"Was selection of participants into the study (or into the analysis) based on participant characteristics observed after the start of intervention?"
- Does NOT address missing data exclusions (Domain 4).
- Assess: Were any inclusion/exclusion criteria based on post-intervention characteristics?

### Q3.4 Answer Guidance (if Q3.3 = Y/PY)
"Were the post-intervention variables that influenced selection likely to be associated with intervention?"

### Q3.5 Answer Guidance (if Q3.4 = Y/PY)
"Were the post-intervention variables that influenced selection likely to be influenced by the outcome or a cause of the outcome?"
- If selection variable associated with BOTH intervention (Q3.4) AND outcome (Q3.5), selection bias is present (collider bias).

### Q3.6 Answer Guidance (if Q3.1 = SN or Q3.5 = Y/PY)
"Is it likely that the analysis corrected for all of the potential selection biases identified above?"
- Methods: IPW, modeling missing follow-up distributions.

### Q3.7 Answer Guidance (if Q3.6 = N/PN/NI)
"Did sensitivity analyses demonstrate that the likely impact of the potential selection biases identified above was minimal?"

### Q3.8 Answer Guidance (if Q3.7 = N/PN/NI)
"Were potential selection biases identified above sufficiently severe that the result should not be included in a quantitative synthesis?"

---

# 8. DOMAIN 4: MISSING DATA

**Sources of missing data**: Attrition/loss to follow-up, missed appointments, incomplete data collection, missing intervention/confounder data.

**No single threshold**: 95% complete may still be biased if outcome rare AND missingness related to intervention group.

**Missing Data Categories (Little & Rubin)**:
- **MCAR** (Missing Completely at Random): No systematic differences between missing and observed. Example: equipment breakdown.
- **MAR** (Missing at Random): Differences explained by observed data. Example: younger people more likely missing, and have lower values.
- **MNAR** (Missing Not at Random): Differences remain after accounting for observed. Example: high values cause missingness (high BP causes headaches causes missed appointments).

**Key**: Multiple imputation avoids bias if MAR/MCAR, but NOT if MNAR.

### Q4.1-4.3 Answer Guidance (Data Completeness)
- "Nearly all" = so few missing they couldn't importantly affect results.
- For dichotomous outcomes: compare event count to missing count. If events >> missing, bias limited.
- Look for: flow diagram, missing data reports, sample sizes at each stage.

### Q4.4 Answer Guidance
"Is the result based on a complete case analysis?"
- Complete case = restricted to those with complete data on ALL intervention, outcome, AND confounders.

### Q4.5 Answer Guidance (if Q4.4 = Y/PY/NI)
"Was exclusion from the analysis because of missing data likely to be related to the true value of the outcome?"
- Answer Y/PY if: (1) different % excluded between intervention groups, (2) different % excluded between outcome groups, (3) reasons suggest missingness depends on outcome, (4) circumstances suggest missingness depends on outcome (e.g., severe depression causes missed appointments).

### Q4.6 Answer Guidance (if Q4.5 = Y/PY/NI)
"Is the relationship between the outcome and missingness likely to be explained by the variables in the analysis model?"

### Q4.7 Answer Guidance (if Q4.4 = N/PN)
"Was the analysis based on imputing missing values?"

### Q4.8 Answer Guidance (if Q4.7 = Y/PY)
"Is it reasonable to assume that data were MAR or MCAR?"
- Answer N/PN only if evidence suggests MNAR (missingness depends on the unobserved value itself).

### Q4.9 Answer Guidance (if Q4.8 = Y/PY)
"Was imputation performed appropriately?"
- For MI: all predictors of missingness AND all analysis variables should be in imputation model.
- Simple imputation (LOCF, mean): answer WN or SN.

### Q4.10 Answer Guidance (if Q4.7 = N/PN/NI)
"Was an appropriate alternative method used to correct for bias due to missing data?"
- Methods: IPW, FIML, pattern mixture models, selection models.

### Q4.11 Answer Guidance (conditional, various paths)
"Is there evidence that the result was not biased by missing data?"
- Look for: sensitivity analyses comparing complete case vs imputed, best/worst case, tipping point analysis, pattern mixture models.

---

# 9. DOMAIN 5: MEASUREMENT OF OUTCOME

**Non-differential measurement error**: Unrelated to intervention. Random error reduces precision. Systematic error does not bias.

**Differential measurement error**: Related to intervention. Biases the intervention-outcome relationship (detection bias).

**Detection bias**: Common differential measurement error. Arises when: (1) outcome assessors aware of intervention (especially for subjective outcomes), (2) different observation methods/intensity between groups, (3) measurement errors related to intervention.

**Blinding**: Prevents systematic measurement differences. Often not possible in observational studies.

### Q5.1 Answer Guidance
"Could measurement or ascertainment of the outcome have differed between intervention groups?"
- Differences may arise from: diagnostic detection bias (intervention causes more healthcare contacts causes more detection), additional visits with intervention.

### Q5.2 Answer Guidance
"Were outcome assessors aware of the intervention received by study participants?"
- When participants report own outcomes (questionnaire), the assessor IS the participant. In observational studies, answer usually Y for self-report.

### Q5.3 Answer Guidance (if Q5.2 = Y/PY/NI)
"Could assessment of the outcome have been influenced by knowledge of the intervention received?"
- Knowledge COULD influence: patient-reported outcomes (pain, symptoms, quality of life), observer-reported outcomes involving judgement, provider decision outcomes (treatment escalation).
- Knowledge UNLIKELY to influence: objective outcomes without judgement (all-cause mortality), laboratory measures, administrative/registry outcomes.
- **Distinguishing SY vs WY**: SY = strong beliefs/preferences make influence LIKELY (e.g., symptoms in study of controversial treatment). WY = influence possible but no specific reason to think it occurred.

---

# 10. DOMAIN 6: SELECTION OF REPORTED RESULT

**Types of selective reporting**:
- **Selective outcome reporting**: Result selected from multiple measurements (scales, definitions, time points)
- **Selective analysis reporting**: Result selected from multiple analytical approaches
- **Subgroup selection**: Cohort selected based on more interesting findings

**Motivations**: Newsworthy findings, commercial interests, desire to show no harm.

**Best protection**: Pre-specified, publicly available analysis plan matching reported results.

**Note**: Protocols for non-randomized studies increasingly registered, but detailed analysis plans rarely available. Plan finalization must PRECEDE availability of unblinded outcome data.

### Q6.1 Answer Guidance
"Was the result reported in accordance with an available, pre-determined analysis plan?"
- Such plans are rarely available for observational studies, so most will not achieve Low risk through Q6.1.

### Q6.2 Answer Guidance (if Q6.1 not Y/PY)
"Is the numerical result likely to have been selected from multiple outcome measurements?"
- Answer Y/PY if: multiple measurements made but only subset reported without justification; selection likely based on statistical significance.
- Answer N/PN if: all reported results match all intended measurements; only one possible way to measure outcome.

### Q6.3 Answer Guidance (if Q6.1 not Y/PY)
"Is the numerical result likely to have been selected from multiple analyses?"
- Multiple analyses may arise from: unadjusted vs adjusted models, final value vs change vs ANCOVA, different intervention/control definitions, variable transformations, different cut-points, different covariate sets, different missing data strategies.

### Q6.4 Answer Guidance (if Q6.1 not Y/PY)
"Is the numerical result likely to have been selected from multiple subgroups?"
- Red flags: unusual subgroup definitions, results for unexpected subgroups, post-hoc subgroup selection, only significant subgroups reported.

---

# 11. OVERALL RISK OF BIAS

**Default rule**: Worst domain judgement = overall judgement.

**Override**: User may judge GREATER risk if problems in several domains compound. For example, several Serious domains may justify Critical overall.

**Low overall** includes the caveat "except for concerns about uncontrolled confounding" since this can never be fully excluded in observational studies.

---

# 12. RESPONSE CODES REFERENCE

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

---

**END OF COMPACTED REFERENCE GUIDE**
