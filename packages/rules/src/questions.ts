import type { Answer, AnswerOption, DomainDef, DomainId, QuestionDef, SectionId } from './types.js';
import { ANSWER_LABELS } from './types.js';

function opts(codes: Answer[], overrides: Partial<Record<Answer, string>> = {}): AnswerOption[] {
  return codes.map((code) => ({ code, label: overrides[code] ?? ANSWER_LABELS[code] }));
}

const STD = (): AnswerOption[] => opts(['Y', 'PY', 'PN', 'N', 'NI']);
const STD_NO_NI = (): AnswerOption[] => opts(['Y', 'PY', 'PN', 'N']);

type Q = Omit<QuestionDef, 'section'> & { officialResponse: string };

function q(section: SectionId, def: Q): QuestionDef & { officialResponse: string } {
  return { section, ...def };
}

// ---------------------------------------------------------------------------
// Section B: triage (decide whether to proceed with a risk-of-bias assessment)
// ---------------------------------------------------------------------------
const TRIAGE: (QuestionDef & { officialResponse: string })[] = [
  q('TRIAGE', {
    id: 'B1',
    short: 'Any attempt to control confounding?',
    text: 'Did the authors make any attempt to control for confounding in the result being assessed?',
    options: STD_NO_NI(),
    officialResponse: 'Y / PY / PN / N',
    elaboration: [
      'Confounding is a substantial problem in most non-randomized studies, and it is usually important to control for the important confounding factors.'
    ],
    hints: ['Look for adjustment methods, covariates, propensity scores, matching, stratification, regression with covariates or inverse probability weighting applied to this result.'],
    searchTerms: ['adjusted', 'multivariable', 'propensity', 'matched', 'matching', 'covariates', 'regression', 'weighting', 'stratified']
  }),
  q('TRIAGE', {
    id: 'B2',
    short: 'Confounding too severe to consider further?',
    text: 'Is there sufficient potential for confounding that this result should not be considered further?',
    conditionText: 'If N/PN to B1',
    options: STD_NO_NI(),
    officialResponse: 'Y / PY / PN / N',
    elaboration: [
      "If there is sufficient potential for confounding that an unadjusted result should not be considered further, then the result is judged to be at 'Critical risk of bias'."
    ],
    hints: ['Consider baseline imbalances and obvious prognostic differences between groups. Y/PY ends the assessment of this result at Critical.'],
    searchTerms: ['baseline characteristics', 'differences between groups', 'Table 1', 'imbalance', 'p <']
  }),
  q('TRIAGE', {
    id: 'B3',
    short: 'Outcome measurement inappropriate?',
    text: 'Was the method of measuring the outcome inappropriate?',
    options: STD_NO_NI(),
    officialResponse: 'Y / PY / PN / N',
    elaboration: [
      "This question aims to identify methods of outcome measurement (or data collection) that are unsuitable for the outcome they are intended to evaluate. It does not assess whether the choice of outcome was sensible (e.g. a surrogate). In most circumstances, for pre-specified outcomes, the answer will be 'N' or 'PN'.",
      "Answer 'Y' or 'PY' if (1) important ranges of outcome values fall outside levels detectable by the measurement method; (2) the instrument has been shown to have such poor reliability or validity that estimates are not useful; or (3) the measurement method differed substantially between intervention and comparator groups so that differences are not interpretable."
    ],
    hints: ['Y/PY ends the assessment of this result at Critical.'],
    searchTerms: ['defined as', 'definition', 'measured', 'assessed', 'diagnosed', 'criteria', 'follow-up']
  })
];

// ---------------------------------------------------------------------------
// Domain 1, Variant A: bias due to confounding (intention-to-treat effect)
// ---------------------------------------------------------------------------
const D1: (QuestionDef & { officialResponse: string })[] = [
  q('D1', {
    id: 'Q1.1',
    short: 'Controlled for all important confounders?',
    text: 'Did the authors control for all the important confounding factors for which this was necessary?',
    options: opts(['Y', 'PY', 'WN', 'SN', 'NI'], {
      WN: 'No, but uncontrolled confounding was probably not substantial',
      SN: 'No, and uncontrolled confounding was probably substantial'
    }),
    officialResponse: 'Y / PY / WN / SN / NI',
    elaboration: [
      'The important confounding factors are those specified in the preliminary evaluation of confounding factors, which determines whether there were important confounding factors that were not controlled for and should have been (because there was no evidence that controlling for them was unnecessary).',
      'Control should use an appropriate method: stratification, regression, matching, standardization or inverse probability weighting (for individual variables or estimated propensity scores).',
      "Answer 'Y' or 'PY' if all the important confounding factors for which control was deemed necessary were controlled for appropriately (also in the very rare situation that there are no confounding factors and an unadjusted analysis is presented).",
      "Answer 'WN' if most were controlled using appropriate methods and any uncontrolled confounding was not likely to be substantial, for example because uncontrolled factors were highly correlated with controlled ones.",
      "Answer 'SN' if at least one important confounding factor should have been controlled for but was not, and this is likely to have a material impact on the estimated effect."
    ],
    hints: ['Base this on the confounding-factor evaluation from the Study session: the factors for this result that were not controlled and for which control was necessary.'],
    searchTerms: ['adjusted for', 'covariates', 'propensity score', 'matched on', 'multivariable', 'confounders']
  }),
  q('D1', {
    id: 'Q1.2',
    short: 'Confounders measured validly and reliably?',
    text: 'Were confounding factors that were controlled for (and for which control was necessary) measured validly and reliably by the variables available in this study?',
    conditionText: 'If Y/PY/WN to 1.1',
    options: opts(['Y', 'PY', 'WN', 'SN', 'NI'], {
      WN: 'No, but the extent of measurement error in confounding factors was probably not substantial',
      SN: 'No, and the extent of measurement error in confounding factors was probably substantial'
    }),
    officialResponse: 'NA / Y / PY / WN / SN / NI',
    elaboration: [
      'Appropriate control of confounding requires that the variables adjusted for are valid and reliable measures of the confounding factors. A list of valid and reliable measures may be specified in the review protocol; study authors may cite references supporting a measure.',
      'If authors control for confounding variables with no indication of their validity or reliability, then subjectivity of the measure should be evaluated.',
      "In the (very rare) situation that there are no confounding factors and an unadjusted analysis is presented, answer 'Y' or 'PY'."
    ],
    hints: ['Use the validity/reliability column of the confounding-factor evaluation for the factors mapped to this result.'],
    searchTerms: ['measured', 'recorded', 'classification', 'ASA', 'comorbidity index', 'self-reported', 'validated']
  }),
  q('D1', {
    id: 'Q1.3',
    short: 'Controlled for post-intervention variables?',
    text: 'Did the authors control for any post-intervention variables that could have been affected by the intervention?',
    conditionText: 'If Y/PY/WN to 1.1',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [
      "Controlling for post-intervention variables that are affected by intervention is not appropriate (sometimes called 'over-adjustment'). Controlling for mediating variables estimates the direct effect of intervention and may introduce bias. Controlling for common effects of intervention and outcome ('colliders') introduces bias."
    ],
    hints: ['List every variable in the adjustment model and check whether each was measured before or after the start of the intervention, and whether it could have been affected by it. Y/PY marks a problem.'],
    searchTerms: ['adjusted for', 'model included', 'postoperative', 'after surgery', 'complications', 'length of stay']
  }),
  q('D1', {
    id: 'Q1.4',
    short: 'Negative controls etc. suggest serious confounding?',
    text: 'Did the use of negative controls, quantitative bias analysis, or other considerations, suggest serious uncontrolled confounding?',
    options: STD_NO_NI(),
    officialResponse: 'Y / PY / PN / N',
    elaboration: [
      'Use of a "negative control" (an alternative analysis in which no association should be observed) can suggest that the result is subject to uncontrolled confounding, if similar associations are identified for the result being assessed and the negative control.',
      "If the study did not use negative controls and no other considerations suggest uncontrolled confounding, answer 'N'.",
      "Answer 'Y' or 'PY' if negative controls indicate that the result being assessed suffers from material bias due to confounding."
    ],
    hints: ['Look for negative control outcomes or exposures, E-values, quantitative bias analyses, sensitivity analyses for unmeasured confounding, and author discussion of residual confounding.'],
    searchTerms: ['negative control', 'E-value', 'sensitivity analysis', 'residual confounding', 'unmeasured confounding', 'bias analysis']
  })
];

// ---------------------------------------------------------------------------
// Domain 2: bias in classification of interventions
// ---------------------------------------------------------------------------
const D2: (QuestionDef & { officialResponse: string })[] = [
  q('D2', {
    id: 'Q2.1',
    short: 'Strategies distinguishable at follow-up start?',
    text: 'Were the intervention strategies distinguishable at the time when follow-up would have started in the target trial?',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      'In the target trial, follow-up starts when participants meet eligibility criteria and are assigned to a strategy. In most non-randomized studies participants are classified according to interventions prescribed or received, but some strategies cannot be distinguished at the start of follow-up (e.g. "surgery within 6 months of diagnosis" vs "delay surgery until progression").',
      "Assigning participants to strategies based on information after the start of follow-up may give one group a period of 'immortal time' during which the outcome cannot occur."
    ],
    hints: ['N/PN signals an immortal time concern. Ask: when did follow-up start, how were participants classified, and could both strategies apply to the same person at the start?'],
    searchTerms: ['follow-up began', 'time zero', 'date of surgery', 'index date', 'classified', 'assigned', 'allocated']
  }),
  q('D2', {
    id: 'Q2.2',
    short: 'Nearly all events after strategies distinguishable?',
    text: 'Did all or nearly all outcome events occur after the intervention and comparator strategies could be distinguished?',
    conditionText: 'If N/PN/NI to 2.1',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [
      'If the period during which the strategies cannot be distinguished is short relative to total follow-up, the proportion of outcome events occurring during that period may be low, limiting the risk of bias from classification based on post-baseline events.'
    ],
    hints: ['Compare the length of the indistinguishable period with total follow-up, and when most events occurred.'],
    searchTerms: ['median time', 'events occurred', 'within days', 'early', 'follow-up duration']
  }),
  q('D2', {
    id: 'Q2.3',
    short: 'Analysis avoided indistinguishability problems?',
    text: 'Did the analysis avoid problems arising from intervention strategies that are not distinguishable at the start of follow-up?',
    conditionText: 'If N/PN/NI to 2.2',
    options: opts(['SY', 'WY', 'PN', 'N', 'NI'], { SY: 'Yes, fully', WY: 'Yes, partially' }),
    officialResponse: 'NA / SY (yes, fully) / WY (yes, partially) / PN / N / NI',
    elaboration: [
      "Clone-censor-weighting or the g-formula can overcome these problems. Answer 'SY' if predictors of treatment during follow-up were measured and used appropriately to derive inverse-probability weights. Answer 'WY' if these or another appropriate method were used but are unlikely to have fully adjusted for prognostic factors predicting treatment after the start of follow-up.",
      "Answer 'SY' for a 'landmark' analysis that starts follow-up after the strategies can be distinguished (such analyses are at risk of selection bias, addressed in Domain 3)."
    ],
    hints: ['Standard analyses that ignore the problem are PN/N.'],
    searchTerms: ['clone', 'censor', 'weighting', 'g-formula', 'landmark', 'time-varying', 'sequential trial']
  }),
  q('D2', {
    id: 'Q2.4',
    short: 'Classification influenced by outcome?',
    text: 'Was classification of intervention status influenced by knowledge of the outcome or risk of the outcome?',
    options: opts(['SY', 'WY', 'PN', 'N', 'NI'], {
      SY: 'Yes, and the impact was substantial',
      WY: 'Yes, but the impact was not substantial'
    }),
    officialResponse: 'SY / WY / PN / N / NI',
    elaboration: [
      'Differential misclassification arises if the outcome, or factors influencing it, influence the classification, for example when classification relies on information collected after follow-up started such as recall of past interventions. It is less likely if all classification information was recorded at or before assignment and the start of follow-up.',
      'Outcome events can also affect the availability of classification information (e.g. intervention records destroyed when a participant dies).',
      "Answer 'SY' if the impact of knowledge of the outcome or risk of the outcome was likely to be substantial."
    ],
    hints: ['Prospective records and blinded classification point to PN/N.'],
    searchTerms: ['prospectively', 'retrospectively', 'database', 'medical records', 'recorded', 'registry', 'chart review']
  }),
  q('D2', {
    id: 'Q2.5',
    short: 'Further classification errors likely?',
    text: 'Were further classification errors (not influenced by knowledge of the outcome or risk of the outcome) likely?',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      'This addresses non-differential misclassification of intervention status, e.g. receipt of intervention not recorded in the information source. Such errors usually bias the result towards the null.',
      'Criteria for considering individuals to have received each intervention should be clear and explicit (type, setting, dose, frequency, intensity, timing). Ambiguity in the definition may lead to misclassification.',
      'It may help to consider separately whether people receiving the intervention, and people receiving the comparator, were correctly classified. In many situations correct classification for 95% of participants may be sufficient.'
    ],
    hints: ['Y/PY when definitions are ambiguous or the data source is unreliable; PN/N when definitions are clear and records reliable. Note: the official elaboration text says ambiguity "is likely to lead to a response of N or PN"; given the question wording, ambiguity points towards Y/PY.'],
    searchTerms: ['defined as', 'hybrid', 'converted', 'conversion', 'approach', 'technique', 'procedure']
  })
];

// ---------------------------------------------------------------------------
// Domain 3: bias in selection of participants into the study (or analysis)
// ---------------------------------------------------------------------------
const D3: (QuestionDef & { officialResponse: string })[] = [
  q('D3', {
    id: 'Q3.1',
    part: 'A. Prevalent user bias and immortal time',
    short: 'Follow-up began at start of strategies?',
    text: 'Did follow up in the analysis begin at the start of the intervention strategies being compared?',
    options: opts(['Y', 'PY', 'WN', 'SN', 'NI'], {
      WN: 'No, but the risk of bias was not substantial',
      SN: 'No, leading to a substantial risk of bias'
    }),
    officialResponse: 'Y / PY / WN / SN / NI',
    elaboration: [
      "Answer 'Y' or 'PY' if all outcome events and follow-up time after the start of the intervention and comparator strategies were included in the analysis. If the comparator is \"no intervention\", follow-up can start at any point at which participants remain eligible to start the intervention.",
      "Analyses in which follow-up starts after the start of the intervention ('landmark' analyses, or analyses including prevalent rather than new users) miss follow-up that would have been observed in the target trial (prevalent user bias).",
      "Answer 'SN' if either (i) the effect of intervention is likely to differ markedly between the excluded and included periods of follow-up; or (ii) a substantial proportion of follow-up or outcomes after the start of the interventions was excluded. (The official text prints 'SY' here; the response option is SN.)"
    ],
    hints: ['Incident users with follow-up starting at intervention start → Y/PY.'],
    searchTerms: ['follow-up', 'from the date of', 'starting from', 'landmark', 'new users', 'incident', 'prevalent']
  }),
  q('D3', {
    id: 'Q3.2',
    part: 'A. Prevalent user bias and immortal time',
    short: 'Early outcome events excluded?',
    text: 'Were outcome events during a period of follow-up after the start of the interventions excluded from the analysis?',
    conditionText: 'If Y/PY to 3.1',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      "If follow-up begins at the start of the interventions but there was a period after the start during which outcomes were not ascertained or events were excluded from the analysis, then this period is 'immortal time' during which events cannot occur."
    ],
    hints: ['Look for grace periods, run-in periods, or exclusion of early events or early deaths.'],
    searchTerms: ['excluded', 'within 30 days', 'early deaths', 'grace period', 'survived', 'at least']
  }),
  q('D3', {
    id: 'Q3.3',
    part: 'B. Other types of selection bias',
    short: 'Selection based on post-start characteristics?',
    text: 'Was selection of participants into the study (or into the analysis) based on participant characteristics observed after the start of intervention (additional to the situations addressed in 3.1 and 3.2)?',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      "Answer 'Y' or 'PY' if selection was based on participant characteristics observed after the start of intervention. Answer 'N' or 'PN' if selection was based only on characteristics observed before the start of intervention (such selection can be addressed by controlling for baseline confounding).",
      'This domain does not address exclusion because of missing data (Domain 4).'
    ],
    hints: ['Check every inclusion/exclusion criterion for post-intervention characteristics (e.g. completed follow-up, survived to discharge, pathology findings).'],
    searchTerms: ['inclusion criteria', 'exclusion criteria', 'excluded', 'were included', 'eligible', 'pathological']
  }),
  q('D3', {
    id: 'Q3.4',
    part: 'B. Other types of selection bias',
    short: 'Selection variables associated with intervention?',
    text: 'Were the post-intervention variables that influenced selection likely to be associated with intervention?',
    conditionText: 'If Y/PY to 3.3',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [
      'Selection bias occurs when selection is related to an effect of either intervention or a cause of intervention and an effect of either the outcome or a cause of the outcome. The result is therefore at risk of selection bias if selection into the study is related to both the intervention and the outcome.'
    ],
    hints: [],
    searchTerms: []
  }),
  q('D3', {
    id: 'Q3.5',
    part: 'B. Other types of selection bias',
    short: 'Selection variables influenced by outcome?',
    text: 'Were the post-intervention variables that influenced selection likely to be influenced by the outcome or a cause of the outcome?',
    conditionText: 'If Y/PY to 3.4',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [
      'If a selection variable is associated with both the intervention (3.4) and the outcome (3.5), conditioning on it induces a spurious association (collider bias).'
    ],
    hints: [],
    searchTerms: []
  }),
  q('D3', {
    id: 'Q3.6',
    part: 'C. Analysis, sensitivity analyses and severity',
    short: 'Analysis corrected for selection biases?',
    text: 'Is it likely that the analysis corrected for all of the potential selection biases identified above?',
    conditionText: 'If SN to 3.1 or Y/PY to 3.5',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [
      'When data for a period of follow-up are completely unavailable it is not possible to correct for the resulting selection bias. In other situations it may be possible, e.g. inverse probability weights creating a pseudo-population without the selection bias, or modelling missing follow-up times and events in prevalent users.',
      "Answer 'Y' or 'PY' if appropriate methods were used and the assumptions required for their validity were likely to be justified. Otherwise the answer will usually be 'N' or 'PN'."
    ],
    hints: [],
    searchTerms: ['inverse probability', 'weighting', 'corrected', 'selection model']
  }),
  q('D3', {
    id: 'Q3.7',
    part: 'C. Analysis, sensitivity analyses and severity',
    short: 'Sensitivity analyses show minimal impact?',
    text: 'Did sensitivity analyses demonstrate that the likely impact of the potential selection biases identified above was minimal?',
    conditionText: 'If N/PN/NI to 3.6',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [],
    hints: [],
    searchTerms: ['sensitivity analysis', 'robust', 'similar results', 'excluding']
  }),
  q('D3', {
    id: 'Q3.8',
    part: 'C. Analysis, sensitivity analyses and severity',
    short: 'Selection biases too severe for synthesis?',
    text: 'Were potential selection biases identified above sufficiently severe that the result should not be included in a quantitative synthesis?',
    conditionText: 'If N/PN/NI to 3.7',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [
      "This question distinguishes between 'Serious' and 'Critical' risk of selection bias. Answer 'N', 'PN' or 'NI' unless there is clear evidence that the selection biases identified were severe."
    ],
    hints: [],
    searchTerms: []
  })
];

// ---------------------------------------------------------------------------
// Domain 4: bias due to missing data
// ---------------------------------------------------------------------------
const NEARLY_ALL =
  '"Nearly all" should be interpreted as that the number of participants excluded from the analysis due to missing data is so small that they could have made no important difference to the estimated effect of the intervention.';
const ONLY_NI =
  "Only answer 'NI' if the study report provides no information about the extent of missing data; this will usually lead to a judgement of high risk of bias due to missing data. Imputed data should be regarded as missing data for this question.";

const D4: (QuestionDef & { officialResponse: string })[] = [
  q('D4', {
    id: 'Q4.1',
    short: 'Complete intervention data?',
    text: 'Were complete data on intervention status available for all, or nearly all, participants?',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [NEARLY_ALL, ONLY_NI],
    hints: ['Report total N and the number and percentage with missing intervention status.'],
    searchTerms: ['missing', 'excluded', 'incomplete', 'not available', 'flow diagram']
  }),
  q('D4', {
    id: 'Q4.2',
    short: 'Complete outcome data?',
    text: 'Were complete data on the outcome available for all, or nearly all, participants?',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      NEARLY_ALL,
      'For continuous outcomes, complete data for 95% (or possibly 90%) of participants would often be sufficient. For dichotomous outcomes, the proportion required is linked to the risk of the event: if the observed number of events is much greater than the number of participants with missing data, the bias would necessarily be small.',
      ONLY_NI
    ],
    hints: ['Report total eligible, lost to follow-up and missing outcome data (n/%). For dichotomous outcomes compare events with missing.'],
    searchTerms: ['lost to follow-up', 'missing', 'follow-up complete', 'available for', 'excluded from analysis']
  }),
  q('D4', {
    id: 'Q4.3',
    short: 'Complete confounder data?',
    text: 'Were complete data on important confounding variables available for all, or nearly all, participants?',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [NEARLY_ALL, ONLY_NI],
    hints: ['Compare the sample in the adjusted analysis with the total; note which confounders had missing data.'],
    searchTerms: ['missing data', 'complete case', 'available for', 'missing values', 'BMI missing']
  }),
  q('D4', {
    id: 'Q4.4',
    short: 'Complete case analysis?',
    text: 'Is the result based on a complete case analysis?',
    conditionText: 'If N/PN/NI to 4.1, 4.2 or 4.3',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [
      'How risk of bias is assessed depends on whether a complete case analysis has been done. A complete case analysis is restricted to participants with complete data on all the intervention, outcome and confounding variables.'
    ],
    hints: [],
    searchTerms: ['complete case', 'imputation', 'imputed', 'missing data were', 'excluded']
  }),
  q('D4', {
    id: 'Q4.5',
    short: 'Exclusion related to true outcome?',
    text: 'Was exclusion from the analysis because of missing data (in intervention, confounders or the outcome) likely to be related to the true value of the outcome?',
    conditionText: 'If Y/PY/NI to 4.4',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [
      'A complete case analysis may be biased if missingness (in intervention, outcome or confounders) is related to the outcome.',
      "Reasons for answering 'Y' or 'PY': (1) different proportions excluded for missing outcome data between intervention groups or confounder levels (for time-to-event data, censoring rates depend on group); (2) different proportions excluded for missing intervention/confounder data between outcome groups; (3) reported reasons for missing outcome data suggest missingness depends on the true outcome or its cause; (4) the circumstances make it likely that missingness depends on the true value (e.g. severe depression causing missed appointments).",
      "Answer 'N' or 'PN' if missing data, loss to follow-up or withdrawal occurred for documented reasons unrelated to the outcome."
    ],
    hints: [],
    searchTerms: ['reasons', 'lost to follow-up', 'withdrew', 'missing', 'excluded because']
  }),
  q('D4', {
    id: 'Q4.6',
    short: 'Missingness explained by model variables?',
    text: 'Is the relationship between the outcome and missingness likely to be explained by the variables in the analysis model?',
    conditionText: 'If Y/PY/NI to 4.5',
    options: opts(['Y', 'PY', 'WN', 'SN', 'NI'], {
      WN: 'No, but not leading to substantial bias',
      SN: 'No, and bias is likely to be substantial'
    }),
    officialResponse: 'NA / Y / PY / WN / SN / NI',
    elaboration: [
      'If all variables that plausibly explain the relationship between the outcome and missingness are included in the complete case analysis, the risk of bias will be low.',
      'Technical note: if a mediator affects missingness, adjusting for it avoids bias due to missing data in a complete case analysis but changes the effect being estimated; multiple imputation should be used instead. Adjusting for a mediator increases the risk of bias due to confounding (Domain 1).'
    ],
    hints: [],
    searchTerms: ['adjusted for', 'model', 'covariates']
  }),
  q('D4', {
    id: 'Q4.7',
    short: 'Analysis based on imputation?',
    text: 'Was the analysis based on imputing missing values?',
    conditionText: 'If N/PN to 4.4',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / NI (N is also accepted here; the algorithm branches on N/PN/NI)',
    elaboration: [
      "Imputing missing values is the process of assigning estimated or assumed values for use in the main analysis. Answer 'Y' or 'PY' if the analysis was based on either single or multiple imputation."
    ],
    hints: [],
    searchTerms: ['imputation', 'imputed', 'multiple imputation', 'last observation carried forward', 'mean imputation']
  }),
  q('D4', {
    id: 'Q4.8',
    short: 'MAR/MCAR reasonable?',
    text: "Is it reasonable to assume that data were 'missing at random' (MAR) or 'missing completely at random' (MCAR)?",
    conditionText: 'If Y/PY to 4.7',
    options: STD(),
    officialResponse: 'NA / Y / PY / PN / N / NI',
    elaboration: [
      'MCAR: no systematic differences between missing and observed values. MAR: any systematic difference is explained by differences in observed data. MNAR: systematic differences remain after the observed data are taken into account.',
      'Multiple imputation can avoid bias if incomplete variables are MAR or MCAR, but not if data are MNAR.',
      "Answer 'N' or 'PN' if there is a reason to believe that data are missing not at random (MNAR). Otherwise, answer 'Y' or 'PY'."
    ],
    hints: [],
    searchTerms: ['missing at random', 'MAR', 'MCAR', 'missingness']
  }),
  q('D4', {
    id: 'Q4.9',
    short: 'Imputation performed appropriately?',
    text: 'Was imputation performed appropriately?',
    conditionText: 'If Y/PY to 4.8',
    options: opts(['Y', 'PY', 'WN', 'SN', 'NI'], {
      WN: 'No, but not leading to substantial bias',
      SN: 'No, such that bias would not be substantially reduced'
    }),
    officialResponse: 'NA / Y / PY / WN / SN / NI',
    elaboration: [
      "Answer 'SN' or 'WN' if simple imputation methods such as last observation carried forward or imputing a mean value are used; the bias introduced depends on the proportion of participants with missing data.",
      "Answer 'Y' or 'PY' if multiple imputation was used and (i) all predictors of missingness in any variable were included in the imputation models; and (ii) all variables in the main analysis model were included in the imputation models."
    ],
    hints: [],
    searchTerms: ['imputation model', 'number of imputations', 'chained equations', 'MICE']
  }),
  q('D4', {
    id: 'Q4.10',
    short: 'Appropriate alternative method?',
    text: 'Was an appropriate alternative method used to correct for bias due to missing data?',
    conditionText: 'If N/PN/NI to 4.7',
    options: opts(['Y', 'PY', 'WN', 'SN', 'NI'], {
      WN: 'No, but not leading to substantial bias',
      SN: 'No, such that bias would not be substantially reduced'
    }),
    officialResponse: 'NA / Y / PY / WN / SN / NI',
    elaboration: [
      'This covers analyses that were neither complete case nor based on imputation, e.g. inverse probability weighting or full information maximum likelihood. The validity of weighting depends on the weighting model being correctly specified. The assessor (possibly with a statistician) should determine whether the analysis was appropriate to correct for any biases.'
    ],
    hints: [],
    searchTerms: ['inverse probability', 'weighting', 'maximum likelihood', 'FIML', 'pattern mixture']
  }),
  q('D4', {
    id: 'Q4.11',
    short: 'Evidence result not biased by missing data?',
    text: 'Is there evidence that the result was not biased by missing data?',
    conditionText: 'If PN/N/NI to 4.1, 4.2 or 4.3 AND (Y/PY/NI to 4.5 OR WN/SN/NI to 4.9 OR WN/SN/NI to 4.10)',
    options: STD_NO_NI(),
    officialResponse: 'NA / Y / PY / PN / N',
    elaboration: [
      'Evidence may come from (1) analysis methods that would not be biased under plausible relationships between missing values and the likelihood that data are missing; or (2) sensitivity analyses showing that results are little changed under a range of plausible assumptions about the missing values.',
      'Multiple imputation based only on outcome, intervention and confounder information should not be assumed to correct for bias due to missing data, so similarity between results with and without such imputation is not reassurance. Similarly, a weighted analysis should not be assumed to correct for bias without further consideration or sensitivity analyses.'
    ],
    hints: [],
    searchTerms: ['sensitivity analysis', 'best case', 'worst case', 'tipping point', 'complete case analysis']
  })
];

// ---------------------------------------------------------------------------
// Domain 5: bias in measurement of the outcome
// ---------------------------------------------------------------------------
const D5: (QuestionDef & { officialResponse: string })[] = [
  q('D5', {
    id: 'Q5.1',
    short: 'Measurement could differ between groups?',
    text: 'Could measurement or ascertainment of the outcome have differed between intervention groups?',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      "Comparable methods of outcome measurement involve the same measurement methods and thresholds, used at comparable time points. Differences between groups may arise from 'diagnostic detection bias' with passive collection of outcome data, or if an intervention involves additional healthcare visits leading to more opportunities for events to be identified."
    ],
    hints: ['Compare method, timing, assessor type and frequency of healthcare contact between groups.'],
    searchTerms: ['assessed', 'measured', 'routine', 'protocol', 'follow-up visits', 'imaging', 'endoscopy', 'contrast']
  }),
  q('D5', {
    id: 'Q5.2',
    short: 'Outcome assessors aware of intervention?',
    text: 'Were outcome assessors aware of the intervention received by study participants?',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      "Answer 'N' if outcome assessors were blinded to intervention status, or were unaware of it without active blinding. When participants report their own outcomes (e.g. a questionnaire) the assessor is the participant; in an observational study the answer will then usually be 'Y'."
    ],
    hints: [],
    searchTerms: ['blinded', 'blind', 'unaware', 'independent assessor', 'self-reported', 'questionnaire']
  }),
  q('D5', {
    id: 'Q5.3',
    short: 'Assessment influenced by knowledge of intervention?',
    text: 'Could assessment of the outcome have been influenced by knowledge of the intervention received?',
    conditionText: 'If Y/PY/NI to 5.2',
    options: opts(['SY', 'WY', 'PN', 'N', 'NI'], { SY: 'Yes, to a large extent', WY: 'Yes, to a small extent' }),
    officialResponse: 'NA / SY (yes, to a large extent) / WY (yes, to a small extent) / PN / N / NI',
    elaboration: [
      'Knowledge of the intervention could influence participant-reported outcomes (such as pain), observer-reported outcomes involving judgement, and intervention-provider decision outcomes. It is unlikely to influence observer-reported outcomes that do not involve judgement, such as all-cause mortality or laboratory measures.',
      "The options distinguish (i) knowledge could have influenced assessment but there is no reason to believe it did (WY) from (ii) knowledge was likely to influence assessment (SY). Strong beliefs in or preferences for beneficial or harmful effects make influence more likely (examples justifying 'SY': patient-reported symptoms in studies of homeopathy, assessments of recovery of function by a physiotherapist)."
    ],
    hints: [],
    searchTerms: ['clinical diagnosis', 'judgement', 'defined as', 'criteria', 'radiological']
  })
];

// ---------------------------------------------------------------------------
// Domain 6: bias in selection of the reported result
// ---------------------------------------------------------------------------
const D6: (QuestionDef & { officialResponse: string })[] = [
  q('D6', {
    id: 'Q6.1',
    short: 'Reported per pre-determined analysis plan?',
    text: 'Was the result reported in accordance with an available, pre-determined analysis plan?',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      'If the pre-specified intentions are available in sufficient detail, planned outcome measurements and analyses can be compared with those presented. Finalization of the analysis intentions must precede availability of unblinded outcome data.',
      'Such plans are rarely publicly available for non-randomized studies, so it is unlikely that a study will be assessed as at low risk of bias for this domain.'
    ],
    hints: ['Look for trial/registry identifiers (ClinicalTrials.gov, PROSPERO, protocol publications) and compare with what was reported.'],
    searchTerms: ['registered', 'protocol', 'ClinicalTrials.gov', 'NCT', 'pre-specified', 'statistical analysis plan']
  }),
  q('D6', {
    id: 'Q6.2',
    short: 'Selected from multiple outcome measurements?',
    text: 'Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple outcome measurements (e.g. scales, definitions, time points) within the outcome domain?',
    conditionText: 'If N/PN/NI to 6.1 (only needed by the algorithm in that case)',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      "Answer 'Y' or 'PY' if there is clear evidence (usually from a protocol or analysis plan) that the domain was measured in multiple ways but only one or a subset is fully reported without justification, and the reported result is likely to have been selected on the basis of the results.",
      "Answer 'N' or 'PN' if all reported results correspond to all intended measurements, if there is only one possible way to measure the outcome domain, or if inconsistencies across reports were explained for reasons unrelated to the results.",
      "Answer 'NI' if analysis intentions are unavailable or insufficiently detailed and there is more than one way in which the outcome domain could have been measured."
    ],
    hints: [],
    searchTerms: ['defined as', 'definition', 'at 30 days', 'at 90 days', 'time points', 'scale']
  }),
  q('D6', {
    id: 'Q6.3',
    short: 'Selected from multiple analyses?',
    text: 'Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple analyses of the data?',
    conditionText: 'If N/PN/NI to 6.1 (only needed by the algorithm in that case)',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      'Multiple analyses may arise from unadjusted and adjusted models; final value vs change from baseline vs ANCOVA; different definitions of intervention and control groups; transformations; cut-points for continuous outcomes; different covariate sets; and different missing data strategies.',
      "Answer 'Y'/'PY', 'N'/'PN' or 'NI' using the same criteria as for 6.2, applied to analyses."
    ],
    hints: [],
    searchTerms: ['unadjusted', 'adjusted', 'univariate', 'multivariable', 'sensitivity analysis', 'propensity']
  }),
  q('D6', {
    id: 'Q6.4',
    short: 'Selected from multiple subgroups?',
    text: 'Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple subgroups?',
    conditionText: 'If N/PN/NI to 6.1 (only needed by the algorithm in that case)',
    options: STD(),
    officialResponse: 'Y / PY / PN / N / NI',
    elaboration: [
      'With large cohorts it is possible to generate multiple estimates for different subgroups or to omit varying proportions of the original cohort. Red flags include unusual subgroup definitions, results for unexpected subgroups, and reporting only significant subgroups.',
      "Answer 'Y'/'PY', 'N'/'PN' or 'NI' using the same criteria as for 6.2, applied to subgroups."
    ],
    hints: [],
    searchTerms: ['subgroup', 'subset', 'stratified by', 'restricted to', 'cohort']
  })
];

export const QUESTIONS: readonly (QuestionDef & { officialResponse: string })[] = [
  ...TRIAGE,
  ...D1,
  ...D2,
  ...D3,
  ...D4,
  ...D5,
  ...D6
];

const BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));

export function getQuestion(id: string): (QuestionDef & { officialResponse: string }) | undefined {
  return BY_ID.get(id);
}

export const TRIAGE_QUESTION_IDS = TRIAGE.map((x) => x.id);

export const DOMAINS: readonly DomainDef[] = [
  {
    id: 'D1',
    title: 'Domain 1: Bias due to confounding (Variant A)',
    short: 'Confounding',
    description:
      'Variant A is used when the analysis estimates the intention-to-treat effect, so only baseline confounding needs to be addressed. Answers draw on the evaluation of confounding factors completed in the Study session.',
    lowLabel: 'Low (except for concerns about uncontrolled confounding)',
    questionIds: D1.map((x) => x.id)
  },
  {
    id: 'D2',
    title: 'Domain 2: Bias in classification of interventions',
    short: 'Classification',
    description:
      'Addresses misclassification arising from immortal time (strategies not distinguishable at the start of follow-up), differential misclassification and non-differential misclassification of intervention status.',
    lowLabel: 'Low',
    questionIds: D2.map((x) => x.id)
  },
  {
    id: 'D3',
    title: 'Domain 3: Bias in selection of participants into the study (or into the analysis)',
    short: 'Selection',
    description:
      'Selection biases arising because participants, periods of follow-up or outcome events were omitted from the analysis because of characteristics measured, or events occurring, after the start of the intervention strategies.',
    lowLabel: 'Low',
    questionIds: D3.map((x) => x.id)
  },
  {
    id: 'D4',
    title: 'Domain 4: Bias due to missing data',
    short: 'Missing data',
    description:
      'Assesses completeness of intervention, outcome and confounder data, then how the analysis handled missing data (complete case, imputation, or another method).',
    lowLabel: 'Low',
    questionIds: D4.map((x) => x.id)
  },
  {
    id: 'D5',
    title: 'Domain 5: Bias in measurement of the outcome',
    short: 'Measurement',
    description:
      'Differential measurement error (detection bias): comparability of ascertainment between groups, assessor awareness, and whether knowledge of the intervention could have influenced assessment.',
    lowLabel: 'Low',
    questionIds: D5.map((x) => x.id)
  },
  {
    id: 'D6',
    title: 'Domain 6: Bias in selection of the reported result',
    short: 'Reported result',
    description:
      'Whether the reported result was selected, on the basis of the results, from multiple outcome measurements, analyses or subgroups.',
    lowLabel: 'Low',
    questionIds: D6.map((x) => x.id)
  }
];

export function getDomain(id: DomainId): DomainDef {
  const d = DOMAINS.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown domain ${id}`);
  return d;
}

/** Which domain a question id belongs to (triage questions return 'TRIAGE'). */
export function sectionOf(questionId: string): SectionId | undefined {
  return BY_ID.get(questionId)?.section;
}

// ---------------------------------------------------------------------------
// Study-level reference lists (Sections C, D and the confounding-factor table)
// ---------------------------------------------------------------------------
export const INFORMATION_SOURCE_OPTIONS = [
  'Journal article(s)',
  'Study protocol',
  'Statistical analysis plan (SAP)',
  'Non-commercial registry record (e.g. ClinicalTrials.gov record)',
  'Company-owned registry record (e.g. GSK Clinical Study Register record)',
  '"Grey literature" (e.g. unpublished thesis)',
  'Conference abstract(s)',
  'Regulatory document (e.g. Clinical Study Report, Drug Approval Package)',
  'Individual participant data',
  'Research ethics application',
  'Grant database summary (e.g. NIH RePORTER, Research Councils UK Gateway to Research)',
  'Personal communication with investigator',
  'Personal communication with sponsor'
] as const;

export const INTERVENTION_TYPES = ['Point', 'Sustained'] as const;
export const COMPARATOR_TYPES = ['Alternative intervention', 'Standard care', 'No intervention'] as const;

export const CF_CONTROLLED_OPTIONS = ['Y', 'N'] as const;
export const CF_VALID_OPTIONS = ['NA', 'Y', 'PY', 'PN', 'N', 'NI'] as const;
export const CF_UNNECESSARY_OPTIONS = ['NA', 'Y', 'PY', 'PN', 'N'] as const;

export const CF_UNNECESSARY_CONDITIONS = [
  { code: 'a', text: 'Measured validly and reliably and not associated with the outcome, conditional on intervention (lack of a statistically significant association is not evidence of no association).' },
  { code: 'b', text: 'Measured validly and reliably and not associated with intervention.' },
  { code: 'c', text: 'Measured validly and reliably and adjustment makes no or minimal difference to the estimated effect.' },
  { code: 'd', text: 'Addressed in the study design, e.g. by restricting to individuals with the same value of the confounder.' },
  { code: 'e', text: 'A negative control demonstrates that confounding by this variable was unlikely, or that uncontrolled confounding was likely to be minimal.' },
  { code: 'f', text: 'External evidence suggests that controlling for the variable is not necessary in the context of the study.' }
] as const;

export const RESPONSE_CODE_REFERENCE = Object.entries({
  Y: 'Yes',
  PY: 'Probably yes',
  PN: 'Probably no',
  N: 'No',
  NI: 'No information',
  NA: 'Not applicable (question not reached)',
  WN: 'No, but not substantial',
  SN: 'No, and substantial',
  WY: 'Yes, but not substantial',
  SY: 'Yes, and substantial'
}).map(([code, meaning]) => ({ code, meaning }));

export const DOMAIN_ORDER: readonly DomainId[] = DOMAINS.map((d) => d.id);
