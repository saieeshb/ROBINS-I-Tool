import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { MIGRATIONS } from './migrations.js';

export type Row = Record<string, unknown>;

export class ConflictError extends Error {
  constructor(
    public entityType: string,
    public current: unknown
  ) {
    super(`${entityType} was changed elsewhere; reload before saving.`);
  }
}

export class NotFoundError extends Error {
  constructor(entityType: string, id: string) {
    super(`${entityType} ${id} not found`);
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}

/** Thin wrapper over node:sqlite with nested transactions (savepoints). */
export class Database {
  readonly db: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(this.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      this.tx(() => {
        this.db.exec(m.sql);
        this.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', m.version, now());
      });
    }
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]): { changes: number | bigint } {
    return this.db.prepare(sql).run(...params);
  }

  /** Runs fn atomically. Nested calls use savepoints, so inner failures roll back only their own work. */
  tx<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    this.db.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
      return out;
    } catch (err) {
      this.depth--;
      this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}

export interface Entity {
  id: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface WriteMeta {
  actor: string;
  /** "autosave" revisions from the same actor within the coalescing window are merged. */
  reason: string;
}

const COALESCE_MS = 2 * 60 * 1000;

/**
 * A JSON-document collection stored in one table. Indexed columns are derived from the entity on every write.
 * Every insert/update is recorded in the `revisions` table; consecutive autosaves by the same actor are coalesced so
 * history stays readable without losing milestones.
 */
export class Collection<T extends Entity> {
  constructor(
    private readonly database: Database,
    readonly table: string,
    readonly entityType: string,
    private readonly columns: Record<string, (e: T) => SQLInputValue>
  ) {}

  private parse(row: Row | undefined): T | undefined {
    return row ? (JSON.parse(row.data as string) as T) : undefined;
  }

  get(id: string): T | undefined {
    return this.parse(this.database.get(`SELECT data FROM ${this.table} WHERE id = ?`, id));
  }

  require(id: string): T {
    const e = this.get(id);
    if (!e) throw new NotFoundError(this.entityType, id);
    return e;
  }

  find(where: Record<string, SQLInputValue> = {}, orderBy = 'created_at'): T[] {
    const keys = Object.keys(where);
    for (const k of keys) if (!(k in this.columns)) throw new Error(`Column ${k} is not indexed on ${this.table}`);
    const clause = keys.length ? `WHERE ${keys.map((k) => (where[k] === null ? `${k} IS NULL` : `${k} = ?`)).join(' AND ')}` : '';
    const params = keys.filter((k) => where[k] !== null).map((k) => where[k]);
    return this.database
      .all(`SELECT data FROM ${this.table} ${clause} ORDER BY ${orderBy}`, ...params)
      .map((r) => this.parse(r)!);
  }

  insert(entity: T, meta: WriteMeta): T {
    const t = now();
    const e = { ...entity, version: 1, createdAt: entity.createdAt ?? t, updatedAt: t } as T;
    const cols = Object.keys(this.columns);
    this.database.tx(() => {
      this.database.run(
        `INSERT INTO ${this.table} (id, data, version, created_at, updated_at${cols.map((c) => `, ${c}`).join('')}) VALUES (?, ?, ?, ?, ?${cols.map(() => ', ?').join('')})`,
        e.id,
        JSON.stringify(e),
        e.version,
        e.createdAt!,
        e.updatedAt!,
        ...cols.map((c) => this.columns[c](e))
      );
      this.recordRevision(e, meta, false);
    });
    return e;
  }

  /**
   * Saves `entity`, which must carry the version it was read at. Throws ConflictError if another write happened
   * in between.
   */
  update(entity: T, meta: WriteMeta): T {
    return this.database.tx(() => {
      const current = this.require(entity.id);
      if (current.version !== entity.version) throw new ConflictError(this.entityType, current);
      const e = { ...entity, version: current.version + 1, createdAt: current.createdAt, updatedAt: now() } as T;
      const cols = Object.keys(this.columns);
      this.database.run(
        `UPDATE ${this.table} SET data = ?, version = ?, updated_at = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`,
        JSON.stringify(e),
        e.version,
        e.updatedAt!,
        ...cols.map((c) => this.columns[c](e)),
        e.id
      );
      this.recordRevision(e, meta, true);
      return e;
    });
  }

  /** Reads the latest version, applies fn, and saves (for server-side changes that must not conflict with the client). */
  mutate(id: string, fn: (e: T) => T | void, meta: WriteMeta): T {
    return this.database.tx(() => {
      const current = this.require(id);
      const draft = structuredClone(current);
      const next = (fn(draft) ?? draft) as T;
      return this.update({ ...next, version: current.version }, meta);
    });
  }

  delete(id: string, meta: WriteMeta): void {
    this.database.tx(() => {
      const current = this.get(id);
      if (!current) return;
      this.database.run(`DELETE FROM ${this.table} WHERE id = ?`, id);
      this.database.run(
        'INSERT INTO revisions (id, entity_type, entity_id, version, data, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        newId(),
        this.entityType,
        id,
        current.version + 1,
        JSON.stringify({ deleted: true, last: current }),
        meta.actor,
        `deleted: ${meta.reason}`,
        now()
      );
    });
  }

  private recordRevision(e: T, meta: WriteMeta, coalesce: boolean): void {
    if (coalesce && meta.reason === 'autosave') {
      const last = this.database.get<{ id: string; actor: string; reason: string; created_at: string }>(
        'SELECT id, actor, reason, created_at FROM revisions WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC, version DESC LIMIT 1',
        this.entityType,
        e.id
      );
      if (last && last.actor === meta.actor && last.reason === 'autosave' && Date.now() - Date.parse(last.created_at) < COALESCE_MS) {
        this.database.run('UPDATE revisions SET data = ?, version = ? WHERE id = ?', JSON.stringify(e), e.version, last.id);
        return;
      }
    }
    this.database.run(
      'INSERT INTO revisions (id, entity_type, entity_id, version, data, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      this.entityType,
      e.id,
      e.version,
      JSON.stringify(e),
      meta.actor,
      meta.reason,
      now()
    );
  }
}
