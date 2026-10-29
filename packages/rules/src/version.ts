/**
 * Ruleset identity. Bump `RULESET_REVISION` whenever any reach condition, option list or algorithm changes,
 * so stored suggestions can be traced to the rules that produced them.
 */
export const RULESET = {
  tool: 'ROBINS-I V2',
  release: '2025-11-20',
  scope: 'Intention-to-treat effect; Domain 1 Variant A',
  revision: '1.0.0'
} as const;

export const RULESET_VERSION = `robins-i-v2@${RULESET.release}/itt-variant-a/${RULESET.revision}`;
