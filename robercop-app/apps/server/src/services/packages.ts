import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Assessment, EvidenceItem, ParseJob, Project, SourceBlock, SourceDocument, Study, StudyRevision, VerificationDecision } from '@robercop/shared';
import { canonicalJson, contentHash, sha256 } from '@robercop/shared/node';
import { RULESET_VERSION } from '@robercop/rules';
import { ValidationError, newId, now } from '../db/database.js';
import type { ConsensusItem, PackageRecord, Store } from '../db/store.js';
import type { AppConfig } from '../config.js';
import type { DocumentService } from './documents.js';

export const PACKAGE_FORMAT = 'robercop-review-package';
export const PACKAGE_FORMAT_VERSION = 1;

export type PackageKind = PackageRecord['kind'];

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  formatVersion: number;
  kind: PackageKind;
  packageId: string;
  createdAt: string;
  createdBy: string;
  appVersion: string;
  rulesetVersion: string;
  origin: { installationId: string };
  project: Pick<Project, 'id' | 'name' | 'verificationMode' | 'cfMatrix' | 'rulesetVersion' | 'description'>;
  study: { id: string; label: string; revision: { id: string; revisionNo: number; hash: string } };
  resultIds: string[];
  assessmentIds: string[];
  note: string;
  /** SHA-256 of every other file in the package. */
  contents: Record<string, string>;
}

interface RevisionRow {
  id: string;
  version: number;
  actor: string;
  reason: string;
  createdAt: string;
  data: unknown;
}

export interface ImportPreview {
  token: string;
  manifest: Omit<PackageManifest, 'contents'>;
  project: { exists: boolean; name: string; modeMatches: boolean };
  study: { exists: boolean; label: string };
  baseline: { status: 'same' | 'new_study' | 'older_local' | 'changed'; message: string };
  documents: { label: string; status: 'new' | 'present' }[];
  assessments: { id: string; reviewer: string; role: string; status: string; result: string; state: AssessmentImportState; detail: string }[];
  evidence: { new: number; present: number; conflicts: number };
  warnings: string[];
}

/**
 * How an incoming assessment relates to the local copy with the same id:
 * - identical: same content.
 * - update: the incoming version continues the local one (the local content appears in the incoming history).
 * - older: the local copy already continues the incoming one.
 * - conflict: both were changed independently.
 */
export type AssessmentImportState = 'new' | 'identical' | 'update' | 'older' | 'conflict';

/** Collects study-level evidence referenced by an approved revision (target trial, results, triage, confounders). */
function revisionEvidenceIds(rev: StudyRevision): Set<string> {
  const ids = new Set<string>();
  const tt = rev.snapshot.data.targetTrial.links;
  for (const list of Object.values(tt)) for (const id of list ?? []) ids.add(id);
  for (const c of rev.snapshot.data.confounders) for (const id of c.evidenceIds) ids.add(id);
  for (const r of rev.snapshot.results) {
    for (const id of r.evidenceIds) ids.add(id);
    for (const list of Object.values(r.triage.evidenceIds ?? {})) for (const id of list ?? []) ids.add(id);
  }
  return ids;
}

export class PackageService {
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly documents: DocumentService
  ) {}

  /**
   * Builds a review package.
   * - independent_assignment: sources + approved study context only. No assessments, no assessment-specific evidence or
   *   assistant output, and evidence tags that point at signalling questions are removed.
   * - checking_assignment: the above plus the first assessment(s) to check, their evidence and verification record.
   * - completed_review: a reviewer's assessments (with evidence, history and verification decisions) to send back.
   */
  export(input: { projectId: string; studyId: string; kind: PackageKind; resultIds?: string[]; assessmentIds?: string[]; note?: string }, actor: string): { filename: string; bytes: Uint8Array; record: PackageRecord } {
    const project = this.store.projects.require(input.projectId);
    const study = this.store.studies.require(input.studyId);
    if (study.projectId !== project.id) throw new ValidationError('The study belongs to another project.');
    if (!study.approvedRevisionId) throw new ValidationError('Approve the Study session before exporting a review package.');
    const revision = this.store.studyRevisions.require(study.approvedRevisionId);
    const resultIds = input.resultIds?.length ? input.resultIds : revision.snapshot.results.map((r) => r.id);
    for (const id of resultIds) if (!revision.snapshot.results.some((r) => r.id === id)) throw new ValidationError('A selected result is not in the approved study revision.');

    let assessments: Assessment[] = [];
    if (input.kind === 'checking_assignment') {
      assessments = this.store.assessments.find({ study_id: study.id }).filter((a) => resultIds.includes(a.resultId) && a.role === 'first' && a.status !== 'draft');
      if (assessments.length === 0) throw new ValidationError('There is no submitted first assessment to check for the selected results.');
    } else if (input.kind === 'completed_review') {
      const ids = input.assessmentIds ?? [];
      const verifiedBy = (a: Assessment) => this.store.verifications.find({ assessment_id: a.id }).some((v) => v.reviewer === actor);
      assessments = ids.length
        ? ids.map((id) => this.store.assessments.require(id))
        : this.store.assessments.find({ study_id: study.id }).filter((a) => resultIds.includes(a.resultId) && (a.reviewer === actor || verifiedBy(a)));
      if (assessments.length === 0) throw new ValidationError('No assessments to include.');
      for (const a of assessments) {
        if (a.studyId !== study.id) throw new ValidationError('An assessment belongs to a different study.');
        if (a.role !== 'consensus' && a.reviewer !== actor && !verifiedBy(a)) throw new ValidationError(`Only ${a.reviewer}, or someone who checked it, can send this assessment back.`);
      }
    }

    const files: Record<string, Uint8Array> = {};
    const putJson = (path: string, value: unknown) => (files[path] = strToU8(JSON.stringify(value, null, 2)));

    // Every revision the included assessments are based on, plus the current approved one.
    const revisions = new Map<string, StudyRevision>([[revision.id, revision]]);
    for (const a of assessments) revisions.set(a.studyRevisionId, this.store.studyRevisions.require(a.studyRevisionId));
    putJson('study/revisions.json', [...revisions.values()]);
    putJson('study/study.json', { id: study.id, label: study.label, projectId: project.id, approvedRevisionId: revision.id });

    const docs: SourceDocument[] = [...this.documents.forStudy(study.id), ...this.documents.referenceDocuments(project.id)];
    putJson('documents/index.json', docs);
    for (const d of docs) {
      files[`documents/${d.id}.pdf`] = new Uint8Array(this.documents.readFile(d));
      const job = this.documents.currentJob(d.id);
      if (!job) continue;
      putJson(`parsed/${job.id}/job.json`, job);
      putJson(`parsed/${job.id}/blocks.json`, this.store.blocksForJob(job.id));
      const md = join(this.config.parsedDir, job.id, 'document.md');
      if (existsSync(md)) files[`parsed/${job.id}/document.md`] = new Uint8Array(readFileSync(md));
    }

    // Evidence: the study-level evidence bank (shared Study session content) and items the revisions refer to; for
    // checking/completed packages also the included assessments' own items.
    const wanted = new Set<string>();
    for (const rev of revisions.values()) for (const id of revisionEvidenceIds(rev)) wanted.add(id);
    for (const a of assessments) for (const r of Object.values(a.responses)) for (const id of r.evidenceIds) wanted.add(id);
    const included = new Set(assessments.map((a) => a.id));
    let evidence = this.store.evidence
      .find({ study_id: study.id })
      .filter((e) => (e.assessmentId === null ? true : included.has(e.assessmentId) || wanted.has(e.id)));
    if (input.kind === 'independent_assignment') {
      evidence = evidence.filter((e) => e.assessmentId === null).map((e) => ({ ...e, questionIds: e.questionIds.filter((q) => !/^Q\d/.test(q)), proposalId: null, runId: null }));
    }
    putJson('evidence/evidence.json', evidence);

    for (const a of assessments) {
      putJson(`assessments/${a.id}.json`, a);
      putJson(`assessments/${a.id}.history.json`, this.store.revisionsFor('assessment', a.id));
      putJson(`assessments/${a.id}.verifications.json`, this.store.verifications.find({ assessment_id: a.id }));
      if (a.role === 'consensus') {
        putJson(`assessments/${a.id}.consensus.json`, this.store.consensusItems.find({ assessment_id: a.id }));
        for (const pid of a.parentIds) {
          const p = this.store.assessments.get(pid);
          if (p) putJson(`assessments/${p.id}.json`, p);
        }
      }
    }

    const contents: Record<string, string> = {};
    for (const [path, bytes] of Object.entries(files)) contents[path] = sha256(bytes);
    const manifest: PackageManifest = {
      format: PACKAGE_FORMAT,
      formatVersion: PACKAGE_FORMAT_VERSION,
      kind: input.kind,
      packageId: newId(),
      createdAt: now(),
      createdBy: actor,
      appVersion: this.config.appVersion,
      rulesetVersion: RULESET_VERSION,
      origin: { installationId: this.store.installationId() },
      project: { id: project.id, name: project.name, verificationMode: project.verificationMode, cfMatrix: project.cfMatrix, rulesetVersion: project.rulesetVersion, description: project.description },
      study: { id: study.id, label: study.label, revision: { id: revision.id, revisionNo: revision.revisionNo, hash: revision.hash } },
      resultIds,
      assessmentIds: assessments.map((a) => a.id),
      note: input.note ?? '',
      contents
    };
    files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
    const bytes = zipSync(files, { level: 6 });
    const kindLabel = { independent_assignment: 'independent', checking_assignment: 'checking', completed_review: 'completed' }[input.kind];
    const filename = `ROBerCOP_${kindLabel}_${study.label.replace(/[^\w-]+/g, '_')}_${manifest.createdAt.slice(0, 10)}.robercop.zip`;
    mkdirSync(this.config.packagesDir, { recursive: true });
    writeFileSync(join(this.config.packagesDir, filename), bytes);
    const record = this.store.packages.insert(
      {
        id: manifest.packageId,
        projectId: project.id,
        direction: 'export',
        kind: input.kind,
        filename,
        sha256: sha256(bytes),
        manifest: { ...manifest, contents: undefined },
        status: 'created',
        notes: [],
        createdBy: actor,
        createdAt: '',
        updatedAt: '',
        version: 0
      },
      { actor, reason: 'package exported' }
    );
    return { filename, bytes, record };
  }

  private readZip(bytes: Uint8Array): { manifest: PackageManifest; files: Record<string, Uint8Array> } {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch {
      throw new ValidationError('This file is not a ROBer COP review package (not a ZIP archive).');
    }
    if (!files['manifest.json']) throw new ValidationError('This ZIP has no manifest.json; it is not a ROBer COP review package.');
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as PackageManifest;
    if (manifest.format !== PACKAGE_FORMAT) throw new ValidationError('Unknown package format.');
    if (manifest.formatVersion > PACKAGE_FORMAT_VERSION) throw new ValidationError(`This package was made by a newer version of ROBer COP (format ${manifest.formatVersion}). Please update.`);
    for (const [path, hash] of Object.entries(manifest.contents)) {
      if (!files[path]) throw new ValidationError(`The package is incomplete: ${path} is missing.`);
      if (sha256(files[path]) !== hash) throw new ValidationError(`The package is damaged: ${path} does not match its checksum.`);
    }
    return { manifest, files };
  }

  /** Compares an incoming assessment with the local copy using content and both histories. */
  private relation(local: Assessment | undefined, incoming: Assessment, incomingHistory: RevisionRow[]): AssessmentImportState {
    if (!local) return 'new';
    const key = (x: unknown) => contentHash(stripMeta(x as Assessment));
    const localKey = key(local);
    const incomingKey = key(incoming);
    if (localKey === incomingKey) return 'identical';
    if (incomingHistory.some((r) => r.data && key(r.data) === localKey)) return 'update';
    if (this.store.revisionsFor('assessment', local.id).some((r) => r.data && key(r.data) === incomingKey)) return 'older';
    return 'conflict';
  }

  private json<T>(files: Record<string, Uint8Array>, path: string, fallback: T): T {
    return files[path] ? (JSON.parse(strFromU8(files[path])) as T) : fallback;
  }

  /** Validates a package and describes what importing it would do. Nothing is changed. */
  preview(bytes: Uint8Array): ImportPreview {
    const { manifest, files } = this.readZip(bytes);
    const token = newId();
    mkdirSync(this.config.tmpDir, { recursive: true });
    writeFileSync(join(this.config.tmpDir, `${token}.zip`), bytes);
    const warnings: string[] = [];
    const project = this.store.projects.get(manifest.project.id);
    const study = this.store.studies.get(manifest.study.id);
    const revisions = this.json<StudyRevision[]>(files, 'study/revisions.json', []);
    const pkgRev = revisions.find((r) => r.id === manifest.study.revision.id)!;
    let baseline: ImportPreview['baseline'];
    if (!study) baseline = { status: 'new_study', message: 'The study is new on this computer; it will be created from the package’s approved revision.' };
    else if (study.approvedRevisionId === pkgRev.id) baseline = { status: 'same', message: `Same approved study revision (#${pkgRev.revisionNo}).` };
    else {
      const local = study.approvedRevisionId ? this.store.studyRevisions.get(study.approvedRevisionId) : undefined;
      const known = this.store.studyRevisions.get(pkgRev.id);
      baseline =
        known && local && local.revisionNo > known.revisionNo
          ? { status: 'older_local', message: `The package is based on revision #${pkgRev.revisionNo}; this computer has #${local.revisionNo}. Imported assessments keep their revision and can be moved forward afterwards.` }
          : { status: 'changed', message: `The study’s approved revision differs (package #${pkgRev.revisionNo}, here ${local ? `#${local.revisionNo}` : 'none'}). Imported work stays attached to the package’s revision and is flagged until reconciled.` };
    }
    if (project && project.verificationMode !== manifest.project.verificationMode) warnings.push('The verification mode in the package differs from this project’s mode.');
    if (manifest.rulesetVersion !== RULESET_VERSION) warnings.push(`The package was made with rules ${manifest.rulesetVersion}; this installation uses ${RULESET_VERSION}. Judgements will be re-evaluated with the local rules.`);

    const docs = this.json<SourceDocument[]>(files, 'documents/index.json', []);
    const evidence = this.json<EvidenceItem[]>(files, 'evidence/evidence.json', []);
    let present = 0;
    let conflicts = 0;
    for (const e of evidence) {
      const local = this.store.evidence.get(e.id);
      if (!local) continue;
      if (local.quote === e.quote && local.documentId === e.documentId && local.interpretation === e.interpretation) present++;
      else conflicts++;
    }
    const assessments = manifest.assessmentIds.map((id) => {
      const a = this.json<Assessment>(files, `assessments/${id}.json`, null as never);
      const local = this.store.assessments.get(id);
      const result = pkgRev.snapshot.results.find((r) => r.id === a.resultId);
      const state = this.relation(local, a, this.json<RevisionRow[]>(files, `assessments/${id}.history.json`, []));
      const detail = {
        new: 'Will be added.',
        identical: 'Already present and unchanged; skipped.',
        update: `Newer version of the copy here (local ${local?.status}); it will be updated, keeping its history.`,
        older: 'This computer already has a later version; the local copy is kept.',
        conflict: `A different version was also changed here (local ${local?.status}, updated ${local?.updatedAt}). It will not be overwritten; choose to import a copy or skip.`
      }[state];
      return { id, reviewer: a.reviewer, role: a.role, status: a.status, result: result ? `${result.outcome}${result.timePoint ? ` · ${result.timePoint}` : ''}` : a.resultId, state, detail };
    });
    const { contents: _c, ...m } = manifest;
    return {
      token,
      manifest: m,
      project: { exists: !!project, name: project?.name ?? manifest.project.name, modeMatches: !project || project.verificationMode === manifest.project.verificationMode },
      study: { exists: !!study, label: study?.label ?? manifest.study.label },
      baseline,
      documents: docs.map((d) => ({ label: d.label, status: this.store.documents.get(d.id) ? 'present' : 'new' })),
      assessments,
      evidence: { new: evidence.length - present - conflicts, present, conflicts },
      warnings
    };
  }

  /** Imports a previewed package. Existing work is never overwritten. */
  commit(token: string, options: { conflicts: 'skip' | 'copy' }, actor: string): PackageRecord {
    const path = join(this.config.tmpDir, `${token}.zip`);
    if (!existsSync(path)) throw new ValidationError('The preview expired; choose the file again.');
    const bytes = new Uint8Array(readFileSync(path));
    const { manifest, files } = this.readZip(bytes);
    const notes: string[] = [];
    const meta = { actor, reason: `imported from package ${manifest.packageId}` };

    this.store.db.tx(() => {
      // Project and study.
      if (!this.store.projects.get(manifest.project.id)) {
        this.store.projects.insertRaw({ ...manifest.project, createdAt: manifest.createdAt, updatedAt: manifest.createdAt, version: 1 } as Project, meta);
        notes.push(`Created project "${manifest.project.name}".`);
      }
      const revisions = this.json<StudyRevision[]>(files, 'study/revisions.json', []);
      const pkgRev = revisions.find((r) => r.id === manifest.study.revision.id)!;
      let study = this.store.studies.get(manifest.study.id);
      if (!study) {
        study = this.store.studies.insertRaw(
          { id: manifest.study.id, projectId: manifest.project.id, label: pkgRev.snapshot.label, data: pkgRev.snapshot.data, status: 'approved', approvedRevisionId: null, createdAt: manifest.createdAt, updatedAt: manifest.createdAt, version: 1 } as Study,
          meta
        );
        for (const r of pkgRev.snapshot.results) this.store.results.insertRaw({ ...r, createdAt: manifest.createdAt, updatedAt: manifest.createdAt, version: 1 }, meta);
        notes.push(`Created study "${study.label}" from approved revision #${pkgRev.revisionNo}.`);
      }
      for (const rev of revisions) {
        const local = this.store.studyRevisions.get(rev.id);
        if (local) {
          if (local.hash !== rev.hash) throw new ValidationError(`Study revision #${rev.revisionNo} exists here with different content; the package cannot be imported safely.`);
          continue;
        }
        if (contentHash(rev.snapshot) !== rev.hash) throw new ValidationError(`Study revision #${rev.revisionNo} in the package fails its integrity check.`);
        this.store.studyRevisions.insertRaw({ ...rev, version: 1 } as StudyRevision & { version: number }, meta);
        notes.push(`Added study revision #${rev.revisionNo} (approved by ${rev.approvedBy}).`);
      }
      if (!study.approvedRevisionId) {
        this.store.studies.mutate(study.id, (s) => void ((s.approvedRevisionId = pkgRev.id), (s.status = 'approved')), meta);
      }

      // Documents, parses and blocks.
      const docs = this.json<SourceDocument[]>(files, 'documents/index.json', []);
      for (const d of docs) {
        if (this.store.documents.get(d.id)) continue;
        const pdf = files[`documents/${d.id}.pdf`];
        if (!pdf || sha256(pdf) !== d.sha256) throw new ValidationError(`Document "${d.label}" is missing or damaged in the package.`);
        const target = this.documents.pathFor(d.sha256, d.filename);
        if (!existsSync(target)) writeFileSync(target, pdf);
        this.store.documents.insertRaw({ ...d, version: 1 } as SourceDocument & { version: number }, meta);
        notes.push(`Added document "${d.label}".`);
      }
      for (const path of Object.keys(files).filter((p) => /^parsed\/[^/]+\/job\.json$/.test(p))) {
        const job = this.json<ParseJob>(files, path, null as never);
        if (this.store.parseJobs.get(job.id)) continue;
        this.store.parseJobs.insertRaw({ ...job, version: 1 } as ParseJob & { version: number }, meta);
        this.store.insertBlocks(this.json<SourceBlock[]>(files, `parsed/${job.id}/blocks.json`, []));
        const md = files[`parsed/${job.id}/document.md`];
        if (md) {
          mkdirSync(join(this.config.parsedDir, job.id), { recursive: true });
          writeFileSync(join(this.config.parsedDir, job.id, 'document.md'), md);
        }
      }

      // Evidence.
      for (const e of this.json<EvidenceItem[]>(files, 'evidence/evidence.json', [])) {
        const local = this.store.evidence.get(e.id);
        if (!local) this.store.evidence.insertRaw(e, meta);
        else if (local.quote !== e.quote || local.documentId !== e.documentId || local.interpretation !== e.interpretation) {
          notes.push(`Evidence "${e.quote.slice(0, 50)}…" differs from the local copy; the local copy was kept.`);
        }
      }

      // Assessments with their history and verification records.
      for (const id of manifest.assessmentIds) {
        const a = this.json<Assessment>(files, `assessments/${id}.json`, null as never);
        const local = this.store.assessments.get(id);
        const imported: Assessment = { ...a, importedFrom: { installationId: manifest.origin.installationId, assessmentId: a.id, packageId: manifest.packageId } };
        const history = this.json<RevisionRow[]>(files, `assessments/${id}.history.json`, []);
        let targetId = id;
        const state = this.relation(local, a, history);
        if (state === 'new') {
          for (const pid of a.parentIds) {
            if (!this.store.assessments.get(pid) && files[`assessments/${pid}.json`]) this.store.assessments.insertRaw(this.json<Assessment>(files, `assessments/${pid}.json`, null as never), meta);
          }
          this.store.assessments.insertRaw(imported, meta);
          this.store.importRevisions('assessment', id, history, manifest.packageId);
          notes.push(`Imported ${a.role === 'consensus' ? 'the consensus record' : `${a.reviewer}’s ${a.role} assessment`} (${a.status}).`);
        } else if (state === 'update') {
          this.store.importRevisions('assessment', id, history, manifest.packageId);
          this.store.assessments.replaceRaw({ ...imported, version: local!.version + 1 }, meta);
          notes.push(`Updated ${a.reviewer}’s assessment to the newer version from the package (${a.status}).`);
        } else if (state === 'older') {
          notes.push(`Kept ${a.reviewer}’s assessment as it is here: this computer already has a later version.`);
        } else if (state === 'conflict') {
          if (options.conflicts === 'copy') {
            targetId = newId();
            this.store.assessments.insertRaw({ ...imported, id: targetId }, meta);
            // The copy gets its own history rows (the originals may already be stored for the local version).
            this.store.importRevisions('assessment', targetId, history.map((r) => ({ ...r, id: newId() })), manifest.packageId);
            notes.push(`Imported ${a.reviewer}’s assessment as a separate copy because a different version was also changed here.`);
          } else {
            notes.push(`Kept the local version of ${a.reviewer}’s assessment: it was changed here too. Its verification record was still imported.`);
          }
        }
        // Verification decisions and consensus items are records in their own right: import them whenever their
        // assessment exists here, even if the assessment itself was unchanged or kept locally.
        let added = 0;
        for (const v of this.json<VerificationDecision[]>(files, `assessments/${id}.verifications.json`, [])) {
          const existing = this.store.verifications.get(v.id);
          if (!existing) {
            this.store.verifications.insertRaw({ ...v, assessmentId: targetId, version: 1 } as VerificationDecision & { version: number }, meta);
            added++;
          } else if (laterVerification(v, existing)) {
            this.store.verifications.replaceRaw({ ...v, assessmentId: existing.assessmentId, version: existing.version + 1 } as VerificationDecision & { version: number }, meta);
            added++;
          }
        }
        if (added) notes.push(`Imported ${added} verification decision(s) on ${a.reviewer}’s assessment.`);
        for (const c of this.json<ConsensusItem[]>(files, `assessments/${id}.consensus.json`, [])) {
          const existing = this.store.consensusItems.get(c.id);
          if (!existing) this.store.consensusItems.insertRaw({ ...c, assessmentId: targetId }, meta);
          else if (c.resolvedAt && (!existing.resolvedAt || c.resolvedAt > existing.resolvedAt)) this.store.consensusItems.replaceRaw({ ...c, assessmentId: existing.assessmentId, version: existing.version + 1 }, meta);
        }
      }
    });

    return this.store.packages.insert(
      {
        id: newId(),
        projectId: manifest.project.id,
        direction: 'import',
        kind: manifest.kind,
        filename: `${manifest.packageId}.robercop.zip`,
        sha256: sha256(bytes),
        manifest: { ...manifest, contents: undefined },
        status: 'imported',
        notes,
        createdBy: actor,
        createdAt: '',
        updatedAt: '',
        version: 0
      },
      { actor, reason: 'package imported' }
    );
  }
}

const RESOLUTION_RANK: Record<VerificationDecision['resolution'], number> = { '': 0, accepted: 1, declined: 1, superseded: 2 };

/** A verification decision moves forward only: unresolved → accepted/declined → superseded. */
function laterVerification(incoming: VerificationDecision, existing: VerificationDecision): boolean {
  const a = RESOLUTION_RANK[incoming.resolution] ?? 0;
  const b = RESOLUTION_RANK[existing.resolution] ?? 0;
  if (a !== b) return a > b;
  return a === 1 && (incoming.resolvedAt ?? '') > (existing.resolvedAt ?? '');
}

/** Content used to compare records across installations (local bookkeeping removed). */
function stripMeta<T extends { version?: number; updatedAt?: string; createdAt?: string; importedFrom?: unknown }>(x: T): unknown {
  const { version: _v, updatedAt: _u, createdAt: _c, importedFrom: _i, ...rest } = x as Record<string, unknown>;
  return JSON.parse(canonicalJson(rest));
}
