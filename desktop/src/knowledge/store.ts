import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  knowledgeDefaults,
  type KnowledgeLibrary,
  type KnowledgeDocument,
  type KnowledgeJob,
  type KnowledgeSettings,
  type KnowledgeHit,
  type KnowledgeNode,
  type KnowledgeEdge,
} from 'ling-desktop/runtime'

/** Raw text stays readable; a disposable token projection supports CJK and identifiers. */
export function searchTokens(text: string): string {
  const normalized = text.normalize('NFKC')
  const identifiers =
    normalized.match(/[A-Za-z][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*/g) ?? []
  const words =
    normalized
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  const tokens = words.flatMap((word) =>
    word
      .split(/([\p{Script=Han}]+)/u)
      .filter(Boolean)
      .flatMap((part) => {
        if (!/[\p{Script=Han}]/u.test(part)) return [part]
        const chars = [...part]
        return [
          ...chars,
          ...chars.slice(0, -1).map((char, i) => char + chars[i + 1]),
        ]
      }),
  )
  return [...identifiers.map((word) => word.toLowerCase()), ...tokens].join(' ')
}

export function searchExcerpt(body: string, query: string): string {
  const lower = body.toLocaleLowerCase(), phrase = query.trim().toLocaleLowerCase()
  let match = lower.indexOf(phrase)
  if (match < 0) {
    const matches = phrase.split(/\s+/).filter(Boolean).map(term => lower.indexOf(term)).filter(index => index >= 0)
    match = matches.length ? Math.min(...matches) : 0
  }
  const start = Math.max(0, match - 80), end = Math.min(body.length, start + 320)
  return `${start ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`
}

export interface IndexedFile {
  path: string
  hash: string
  body: string
  commit?: string
  nodes: KnowledgeNode[]
  imports: string[]
  edges: KnowledgeEdge[]
}
interface JobRow extends KnowledgeJob {
  payload: string
  attempts: number
}

export class KnowledgeStore {
  readonly db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:')
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    this.db.exec(
      'PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;',
    )
    const version = Number(
      (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version,
    )
    if (version > 2) {
      this.db.close()
      throw new Error('知识库由更新版本创建，请升级应用。')
    }
    // Explicit product reset: version 1 content, revisions, indexes and pending jobs are discarded.
    if (version === 1)
      this.db.exec(
        `BEGIN; DROP TABLE IF EXISTS documents; DROP TABLE IF EXISTS revisions; DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS meta; DROP TABLE IF EXISTS jobs; DROP TABLE IF EXISTS search; COMMIT; VACUUM; PRAGMA wal_checkpoint(TRUNCATE);`,
      )
    this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, sources TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL, manual INTEGER NOT NULL, updatedAt INTEGER NOT NULL,libraryId TEXT,parentId TEXT,position INTEGER);
      CREATE TABLE IF NOT EXISTS libraries(id TEXT PRIMARY KEY,scope TEXT NOT NULL,value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS documents_scope ON documents(scope,kind,state);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(id,version));
      CREATE TABLE IF NOT EXISTS files(scope TEXT NOT NULL,path TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,path));
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,message TEXT,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,scope UNINDEXED,kind UNINDEXED,title,body, tokenize='unicode61');
      PRAGMA user_version=2; COMMIT;`)
    // Running operations had no terminal outcome before shutdown. Restart idempotently.
    this.db
      .prepare(
        "UPDATE jobs SET status='queued',message=NULL WHERE status='running'",
      )
      .run()
  }
  libraries(scope?: string): KnowledgeLibrary[] {
    const rows = scope
      ? this.db
          .prepare('SELECT value FROM libraries WHERE scope=? ORDER BY id')
          .all(scope)
      : this.db.prepare('SELECT value FROM libraries ORDER BY id').all()
    return rows
      .map((row) => {
        const value = JSON.parse(String(row.value)) as KnowledgeLibrary
        return {
          ...value,
          documents: Number(
            this.db
              .prepare(
                "SELECT COUNT(*) AS n FROM documents WHERE scope=? AND libraryId=? AND state!='archived'",
              )
              .get(value.scope, value.id)?.n ?? 0,
          ),
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }
  accessibleLibraries(scope: string): KnowledgeLibrary[] {
    return this.libraries().filter(
      (library) =>
        library.access === 'all' ||
        (library.access === 'selected'
          ? library.bindings?.some((binding) => binding.scope === scope)
          : library.scope === scope),
    )
  }
  references(scope: string): KnowledgeDocument[] {
    return this.accessibleLibraries(scope).flatMap((library) =>
      this.list(library.scope).filter(
        (doc) =>
          doc.kind === 'reference' &&
          doc.libraryId === library.id &&
          doc.state !== 'archived',
      ),
    )
  }
  reference(scope: string, id: string): KnowledgeDocument | undefined {
    return this.references(scope).find((doc) => doc.id === id)
  }
  library(scope: string, id: string): KnowledgeLibrary | undefined {
    return this.libraries(scope).find((item) => item.id === id)
  }
  saveLibrary(
    scope: string,
    input: Omit<
      KnowledgeLibrary,
      'scope' | 'version' | 'updatedAt' | 'documents'
    > & { version?: number },
  ): KnowledgeLibrary {
    const old = this.library(scope, input.id)
    if (
      !old &&
      this.db.prepare('SELECT 1 FROM libraries WHERE id=?').get(input.id)
    )
      throw new Error('知识库不属于此项目。')
    if (old && input.version !== old.version)
      throw new Error('知识库已更新，请重新打开。')
    const value: KnowledgeLibrary = {
      ...input,
      scope,
      version: (old?.version ?? 0) + 1,
      updatedAt: Date.now(),
      documents: old?.documents ?? 0,
    }
    this.db
      .prepare('INSERT OR REPLACE INTO libraries VALUES (?,?,?)')
      .run(value.id, scope, JSON.stringify(value))
    return value
  }
  deleteLibrary(scope: string, id: string, version: number) {
    const old = this.library(scope, id)
    if (!old || old.version !== version)
      throw new Error('知识库已更新或不属于此项目。')
    this.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM revisions WHERE id IN (SELECT id FROM documents WHERE scope=? AND libraryId=?)',
        )
        .run(scope, id)
      this.db
        .prepare(
          'DELETE FROM search WHERE scope=? AND id IN (SELECT id FROM documents WHERE scope=? AND libraryId=?)',
        )
        .run(scope, scope, id)
      this.db
        .prepare('DELETE FROM documents WHERE scope=? AND libraryId=?')
        .run(scope, id)
      this.db
        .prepare('DELETE FROM libraries WHERE scope=? AND id=?')
        .run(scope, id)
    })
  }
  rules(scope: string): KnowledgeDocument[] {
    return this.db
      .prepare(
        "SELECT * FROM documents WHERE scope=? AND kind='memory' AND state='active' ORDER BY updatedAt DESC LIMIT 8",
      )
      .all(scope)
      .map((row) => this.decode(row))
  }
  close() {
    this.db.close()
  }
  private transactionDepth = 0
  transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.transactionDepth++
    try {
      const value = fn()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.transactionDepth--
    }
  }
  meta<T>(key: string, fallback: T): T {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key=?')
      .get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : fallback
  }
  setMeta(key: string, value: unknown) {
    this.db
      .prepare('INSERT OR REPLACE INTO meta VALUES (?,?)')
      .run(key, JSON.stringify(value))
  }
  settings(): KnowledgeSettings {
    return {
      ...knowledgeDefaults,
      ...this.meta<Partial<KnowledgeSettings>>('settings', {}),
    }
  }
  private decode(row: Record<string, unknown>): KnowledgeDocument {
    const value: Record<string, unknown> = {
      ...row,
      sources: JSON.parse(String(row.sources)),
      manual: Boolean(row.manual),
    }
    for (const key of ['libraryId', 'parentId', 'position'])
      if (value[key] === null) delete value[key]
    return value as unknown as KnowledgeDocument
  }
  read(scope: string, id: string): KnowledgeDocument | undefined {
    const row = this.db
      .prepare('SELECT * FROM documents WHERE id=? AND scope=?')
      .get(id, scope)
    return row ? this.decode(row) : undefined
  }
  list(scope: string): KnowledgeDocument[] {
    return this.db
      .prepare(
        'SELECT * FROM documents WHERE scope=? ORDER BY updatedAt DESC LIMIT 500',
      )
      .all(scope)
      .map((row) => this.decode(row))
  }
  /** Same window as list(), without transferring or decoding document bodies. */
  revisionRows(scope: string) {
    return this.db.prepare('SELECT id,version,state,kind,libraryId FROM documents WHERE scope=? ORDER BY updatedAt DESC LIMIT 500').all(scope)
  }
  projectStatus(scope: string): import('ling-desktop/runtime').KnowledgeProjectStatus {
    const counts = this.db.prepare("SELECT SUM(kind='wiki') AS pages,SUM(kind='card') AS cards,MAX(CASE WHEN kind='wiki' THEN updatedAt END) AS updatedAt FROM documents WHERE scope=? AND state!='archived'").get(scope)!
    const jobs = this.jobs(scope).filter(job => job.kind === 'wiki')
    const pages = Number(counts.pages ?? 0)
    return { state: jobs.some(job => ['queued', 'running'].includes(job.status)) ? 'busy' : jobs[0]?.status === 'failed' ? 'error' : pages ? 'ready' : 'empty', pages, cards: Number(counts.cards ?? 0), ...(counts.updatedAt ? { updatedAt: Number(counts.updatedAt) } : {}) }
  }
  versions(scope: string, id: string): KnowledgeDocument[] {
    if (!this.read(scope, id)) return []
    return this.db
      .prepare(
        'SELECT value FROM revisions WHERE id=? ORDER BY version DESC LIMIT 30',
      )
      .all(id)
      .map((row) => JSON.parse(String(row.value)) as KnowledgeDocument)
  }
  put(
    scope: string,
    input: Omit<KnowledgeDocument, 'scope' | 'version' | 'updatedAt'> & {
      version?: number
    },
  ): KnowledgeDocument {
    return this.transaction(() => {
      const old = this.read(scope, input.id)
      // ids are never transferable across scopes, even when a caller guesses an id.
      if (
        !old &&
        this.db.prepare('SELECT 1 FROM documents WHERE id=?').get(input.id)
      )
        throw new Error('内容不属于此工作区。')
      if (old && input.version !== old.version)
        throw new Error('内容已更新，请重新打开后再保存。')
      const value: KnowledgeDocument = {
        ...input,
        scope,
        version: (old?.version ?? 0) + 1,
        updatedAt: Date.now(),
      }
      this.db
        .prepare(
          'INSERT OR REPLACE INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          value.id,
          scope,
          value.kind,
          value.title,
          value.body,
          JSON.stringify(value.sources),
          value.state,
          value.version,
          Number(value.manual),
          value.updatedAt,
          value.libraryId ?? null,
          value.parentId ?? null,
          value.position ?? null,
        )
      this.db
        .prepare('INSERT INTO revisions VALUES (?,?,?)')
        .run(value.id, value.version, JSON.stringify(value))
      this.project(
        value.id,
        scope,
        value.kind,
        value.title,
        value.state === 'active' || value.state === 'stale' ? value.body : '',
      )
      return value
    })
  }
  generated(
    scope: string,
    input: Omit<
      KnowledgeDocument,
      'scope' | 'version' | 'updatedAt' | 'manual'
    >,
  ): KnowledgeDocument {
    const old = this.read(scope, input.id)
    if (old?.manual || old?.state === 'archived') {
      const proposalId = `${input.id}:proposal`
      const proposal = this.read(scope, proposalId)
      this.setMeta(`proposal:${scope}:${proposalId}`, {
        targetId: old.id,
        targetVersion: old.version,
      })
      return this.put(scope, {
        ...input,
        id: proposalId,
        state: 'candidate',
        manual: false,
        version: proposal?.version,
      })
    }
    return this.put(scope, { ...input, manual: false, version: old?.version })
  }
  remove(scope: string, id: string, version: number) {
    const old = this.read(scope, id)
    if (!old) throw new Error('内容已不存在。')
    // Tombstone instead of deleting provenance/revisions or recreating remembered facts.
    return this.put(scope, { ...old, version, state: 'archived' })
  }
  project(
    id: string,
    scope: string,
    kind: string,
    title: string,
    body: string,
  ) {
    this.db.prepare('DELETE FROM search WHERE id=? AND scope=?').run(id, scope)
    if (body)
      this.db
        .prepare('INSERT INTO search VALUES (?,?,?,?,?)')
        .run(id, scope, kind, searchTokens(title), searchTokens(body))
  }
  search(
    scope: string,
    query: string,
    kind?: string,
    libraryId?: string,
  ): KnowledgeHit[] {
    const terms = [
      ...new Set(searchTokens(query).split(' ').filter(Boolean)),
    ].slice(0, 32)
    if (!terms.length) return []
    const match = terms
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(' AND ')
    const rows = this.db
      .prepare(
        'SELECT id,kind FROM search WHERE search MATCH ? AND scope=? AND (? IS NULL OR kind=?) AND (? IS NULL OR id IN (SELECT id FROM documents WHERE libraryId=? AND scope=?)) ORDER BY bm25(search) LIMIT 50',
      )
      .all(
        match,
        scope,
        kind ?? null,
        kind ?? null,
        libraryId ?? null,
        libraryId ?? null,
        scope,
      )
    return rows.flatMap<KnowledgeHit>((row) => {
      if (row.kind === 'code') {
        const file = this.file(scope, String(row.id))
        if (!file) return []
        const lines = file.body.split('\n'),
          needle = query.toLowerCase()
        const line = Math.max(
          0,
          lines.findIndex((text) => text.toLowerCase().includes(needle)),
        )
        return [
          {
            id: `code:${String(row.id)}`,
            kind: 'code' as const,
            title: file.path,
            snippet: lines
              .slice(line, line + 3)
              .join('\n')
              .slice(0, 320),
            source: {
              kind: 'code' as const,
              label: file.path,
              path: file.path,
              line: line + 1,
              hash: file.hash,
              commit: file.commit,
            },
          },
        ]
      }
      const doc = this.read(scope, String(row.id))
      return doc && doc.state !== 'archived' && doc.state !== 'candidate'
        ? [
            {
              id: doc.id,
              kind: doc.kind,
              title: doc.title,
              snippet: searchExcerpt(doc.body, query),
              source: doc.sources[0],
              state: doc.state,
            },
          ]
        : []
    })
  }
  fileCount(scope: string): number {
    return Number(
      this.db
        .prepare('SELECT COUNT(*) AS count FROM files WHERE scope=?')
        .get(scope)?.count ?? 0,
    )
  }
  files(scope: string): IndexedFile[] {
    return this.db
      .prepare('SELECT value FROM files WHERE scope=? ORDER BY path')
      .all(scope)
      .map((row) => JSON.parse(String(row.value)) as IndexedFile)
  }
  structure(scope: string): IndexedFile[] {
    return this.db
      .prepare(
        "SELECT json_extract(value,'$.path') AS path,json_extract(value,'$.hash') AS hash,json_extract(value,'$.nodes') AS nodes,json_extract(value,'$.imports') AS imports,json_extract(value,'$.edges') AS edges FROM files WHERE scope=?",
      )
      .all(scope)
      .map((row) => ({
        path: String(row.path),
        hash: String(row.hash),
        body: '',
        nodes: JSON.parse(String(row.nodes)),
        imports: JSON.parse(String(row.imports)),
        edges: JSON.parse(String(row.edges)),
      }))
  }
  file(scope: string, path: string): IndexedFile | undefined {
    const row = this.db
      .prepare('SELECT value FROM files WHERE scope=? AND path=?')
      .get(scope, path)
    return row ? (JSON.parse(String(row.value)) as IndexedFile) : undefined
  }
  replaceFiles(scope: string, files: IndexedFile[]) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM files WHERE scope=?').run(scope)
      this.db
        .prepare("DELETE FROM search WHERE scope=? AND kind='code'")
        .run(scope)
      const insert = this.db.prepare('INSERT INTO files VALUES (?,?,?)')
      for (const file of files) {
        insert.run(scope, file.path, JSON.stringify(file))
        this.project(
          file.path,
          scope,
          'code',
          `${file.path} ${file.nodes.map((node) => node.label).join(' ')}`,
          file.body,
        )
      }
      this.setMeta(`indexedAt:${scope}`, Date.now())
    })
    for (const document of this.list(scope)) {
      if (
        document.state !== 'active' ||
        !document.sources.some(
          (source) =>
            source.kind === 'code' &&
            files.find((file) => file.path === source.path)?.hash !==
              source.hash,
        )
      )
        continue
      this.put(scope, { ...document, state: 'stale' })
    }
  }
  enqueue(
    scope: string,
    kind: KnowledgeJob['kind'],
    payload: unknown,
    id: string = randomUUID(),
  ): KnowledgeJob {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO jobs (id,scope,kind,status,createdAt,updatedAt,payload) VALUES (?,?,?,'queued',?,?,?)",
      )
      .run(id, scope, kind, Date.now(), Date.now(), JSON.stringify(payload))
    const job = this.job(scope, id)
    if (!job) throw new Error('任务范围不一致。')
    return job
  }
  job(scope: string, id: string): JobRow | undefined {
    return this.db
      .prepare('SELECT * FROM jobs WHERE scope=? AND id=?')
      .get(scope, id) as unknown as JobRow | undefined
  }
  jobs(scope?: string): JobRow[] {
    return (scope
      ? this.db
          .prepare(
            'SELECT * FROM jobs WHERE scope=? ORDER BY createdAt DESC LIMIT 100',
          )
          .all(scope)
      : this.db
          .prepare(
            "SELECT * FROM jobs WHERE status='queued' ORDER BY createdAt",
          )
          .all()) as unknown as JobRow[]
  }
  updateJob(id: string, status: KnowledgeJob['status'], message?: string) {
    this.db
      .prepare(
        'UPDATE jobs SET status=?,message=?,updatedAt=?,attempts=attempts+? WHERE id=?',
      )
      .run(
        status,
        message ?? null,
        Date.now(),
        Number(status === 'running'),
        id,
      )
  }
  progress(id: string, message: string) {
    this.db.prepare("UPDATE jobs SET message=?,updatedAt=? WHERE id=? AND status='running'")
      .run(message, Date.now(), id)
  }

}
