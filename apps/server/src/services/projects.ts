import { RULESET_VERSION } from '@robercop/rules';
import type { Project, VerificationMode } from '@robercop/shared';
import { ValidationError, newId } from '../db/database.js';
import type { Store } from '../db/store.js';
import { DEFAULT_CF_MATRIX } from './cfMatrix.js';

export class ProjectService {
  constructor(private readonly store: Store) {}

  list(): Project[] {
    return this.store.projects.find({}, 'created_at DESC');
  }

  create(input: { name: string; description?: string; verificationMode: VerificationMode; cfMatrix?: Record<string, string[]> }, actor: string): Project {
    if (!input.name?.trim()) throw new ValidationError('Project name is required.');
    if (!['independent', 'checking'].includes(input.verificationMode)) throw new ValidationError('Choose a verification mode.');
    const project: Project = {
      id: newId(),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      verificationMode: input.verificationMode,
      rulesetVersion: RULESET_VERSION,
      cfMatrix: normalizeMatrix(input.cfMatrix ?? DEFAULT_CF_MATRIX),
      createdAt: '',
      updatedAt: '',
      version: 0
    };
    return this.store.projects.insert(project, { actor, reason: 'created' });
  }

  update(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'verificationMode' | 'cfMatrix'>> & { version: number }, actor: string): Project {
    const current = this.store.projects.require(id);
    if (patch.verificationMode && patch.verificationMode !== current.verificationMode) {
      const started = this.store.assessments.find({ project_id: id }).filter((a) => a.role !== 'first' || a.status !== 'draft');
      if (started.length > 0) throw new ValidationError('The verification mode cannot change once verification work has started.');
    }
    const next: Project = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.verificationMode ? { verificationMode: patch.verificationMode } : {}),
      ...(patch.cfMatrix ? { cfMatrix: normalizeMatrix(patch.cfMatrix) } : {}),
      version: patch.version
    };
    return this.store.projects.update(next, { actor, reason: 'edited' });
  }
}

export function normalizeMatrix(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('The confounder matrix must map outcome names to lists of factors.');
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ValidationError(`Confounders for "${k}" must be a list of names.`);
    const key = k.trim();
    if (key) out[key] = [...new Set((v as string[]).map((x) => x.trim()).filter(Boolean))];
  }
  return out;
}

/**
 * Matches an outcome name against matrix keys: case-insensitive exact match first, then substring matches on either
 * side or on any "/"-separated part (e.g. "SSI" → "Wound Infection/SSI"). Returns all candidates when ambiguous.
 */
export function matchOutcome(matrix: Record<string, string[]>, outcome: string): string[] {
  const q = outcome.trim().toLowerCase();
  if (!q) return [];
  const keys = Object.keys(matrix);
  const exact = keys.filter((k) => k.toLowerCase() === q);
  if (exact.length) return exact;
  return keys.filter((k) => {
    const kl = k.toLowerCase();
    if (kl.includes(q) || q.includes(kl)) return true;
    return kl.split('/').some((part) => {
      const p = part.trim();
      return p.length > 1 && (p.includes(q) || q.includes(p));
    });
  });
}
