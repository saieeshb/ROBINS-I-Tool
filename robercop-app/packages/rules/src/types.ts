/** Response codes used by ROBINS-I V2 signalling questions. */
export type Answer = 'Y' | 'PY' | 'PN' | 'N' | 'NI' | 'NA' | 'WN' | 'SN' | 'WY' | 'SY';

export const ANSWER_LABELS: Record<Answer, string> = {
  Y: 'Yes',
  PY: 'Probably yes',
  PN: 'Probably no',
  N: 'No',
  NI: 'No information',
  NA: 'Not applicable',
  WN: 'No, but not substantial',
  SN: 'No, and substantial',
  WY: 'Yes, but not substantial',
  SY: 'Yes, and substantial'
};

export type Judgement = 'Low' | 'Moderate' | 'Serious' | 'Critical';

export const JUDGEMENT_ORDER: readonly Judgement[] = ['Low', 'Moderate', 'Serious', 'Critical'];

export function judgementRank(j: Judgement): number {
  return JUDGEMENT_ORDER.indexOf(j);
}

export function worstJudgement(js: readonly Judgement[]): Judgement | undefined {
  let worst: Judgement | undefined;
  for (const j of js) if (worst === undefined || judgementRank(j) > judgementRank(worst)) worst = j;
  return worst;
}

export type DomainId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6';
export const DOMAIN_IDS: readonly DomainId[] = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];

export type SectionId = 'TRIAGE' | DomainId;

/** Answers keyed by question id (e.g. "Q1.1", "B2"). Missing or empty means unanswered. */
export type AnswerMap = Partial<Record<string, Answer | '' | null | undefined>>;

export interface AnswerOption {
  code: Answer;
  /** Wording of the option as given in the official tool (e.g. WN wording differs by question). */
  label: string;
}

export interface QuestionDef {
  id: string;
  section: SectionId;
  /** Sub-part label within a domain (e.g. Domain 3 parts A/B/C). */
  part?: string;
  /** Official question wording. */
  text: string;
  /** Short label used in navigation and tables. */
  short: string;
  options: AnswerOption[];
  /** Official "If ... to ..." condition, as printed, or undefined when always asked. */
  conditionText?: string;
  /** Official elaboration, condensed but faithful to the November 2025 release. */
  elaboration: string[];
  /** Practical answer guidance carried over from the project's reference guide and session prompts. */
  hints: string[];
  /** Terms the evidence finder should look for. */
  searchTerms: string[];
}

export interface DomainDef {
  id: DomainId;
  title: string;
  short: string;
  description: string;
  /** Wording of the Low judgement for this domain (Domain 1 carries the confounding caveat). */
  lowLabel: string;
  questionIds: string[];
}

export interface PathStep {
  /** Question id, or a group label such as "Q4.1–4.3" when the diagram combines questions. */
  questionId: string;
  /** The answer, or answers joined with "/" for grouped steps. */
  answer: string;
  /** Branch label from the algorithm diagram, e.g. "Y/PY". */
  branch: string;
}

export type EvaluationStatus = 'complete' | 'incomplete' | 'invalid';

export interface ReachedQuestion {
  id: string;
  reached: boolean;
  answered: boolean;
  /** True when the question is answered but no longer reached; its answer is retained but excluded from scoring. */
  excluded: boolean;
}

export interface DomainEvaluation {
  domain: DomainId;
  rulesetVersion: string;
  /** complete: algorithm reached a judgement. incomplete: a question on the path is unanswered. invalid: an answer on the path is not usable by the algorithm. */
  status: EvaluationStatus;
  suggested?: Judgement;
  path: PathStep[];
  /** Next unanswered question the algorithm needs, when status is incomplete. */
  needs?: string;
  /** Explanation when status is invalid. */
  problem?: string;
  questions: ReachedQuestion[];
  /** Reached questions still unanswered (completeness for submission, independent of scoring). */
  outstanding: string[];
  /** Answered questions excluded from scoring because an upstream answer made them unreachable. */
  excluded: string[];
}
