import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import type { LingEvolutionSuggestion } from 'ling-desktop/runtime'

export interface EvolutionProposal {
  name: string
  description: string
  content: string
  seqs: number[]
}
export interface SavedEvolutionSuggestion extends LingEvolutionSuggestion {
  content: string
  scope: string
  status: 'candidate' | 'created' | 'ignored'
}
interface SuggestionRow {
  id: string; scope: string; task_id: string; name: string; description: string; content: string; version: number
  created_at: number; through_seq: number; seqs: string; status: SavedEvolutionSuggestion['status']
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
function view(row: SuggestionRow): SavedEvolutionSuggestion {
  return { id: row.id, scope: row.scope, name: row.name, description: row.description, content: row.content, version: row.version,
    createdAt: row.created_at, status: row.status, source: { taskId: row.task_id, throughSeq: row.through_seq, seqs: JSON.parse(row.seqs) as number[] } }
}
/** Profile-local proposals and decisions; no session log or knowledge database is modified. */
export class EvolutionStore {
  readonly db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS suggestions (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, task_id TEXT NOT NULL, name TEXT NOT NULL,
        description TEXT NOT NULL, content TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL,
        through_seq INTEGER NOT NULL, seqs TEXT NOT NULL, status TEXT NOT NULL,
        UNIQUE(scope, task_id, name)
      );
      CREATE INDEX IF NOT EXISTS suggestions_task ON suggestions(scope, task_id, status);
      CREATE TABLE IF NOT EXISTS observations (scope TEXT NOT NULL, task_id TEXT NOT NULL, through_seq INTEGER NOT NULL, PRIMARY KEY(scope, task_id));`)
  }
  list(scope: string, taskId: string): LingEvolutionSuggestion[] {
    return (this.db.prepare("SELECT * FROM suggestions AS candidate WHERE scope=? AND task_id=? AND status='candidate' AND NOT EXISTS (SELECT 1 FROM suggestions AS decision WHERE decision.scope=candidate.scope AND decision.name=candidate.name AND decision.status IN ('ignored','created')) ORDER BY created_at DESC, name").all(scope, taskId) as unknown as SuggestionRow[])
      .map(row => { const { content: _content, status: _status, scope: _scope, ...suggestion } = view(row); return suggestion })
  }
  read(scope: string, taskId: string, id: string): SavedEvolutionSuggestion | undefined {
    const row = this.db.prepare('SELECT * FROM suggestions WHERE scope=? AND task_id=? AND id=?').get(scope, taskId, id) as unknown as SuggestionRow | undefined
    return row ? view(row) : undefined
  }
  throughSeq(scope: string, taskId: string): number {
    return (this.db.prepare('SELECT through_seq FROM observations WHERE scope=? AND task_id=?').get(scope, taskId) as { through_seq: number } | undefined)?.through_seq ?? -1
  }
  publish(scope: string, taskId: string, throughSeq: number, proposals: readonly EvolutionProposal[]): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (this.throughSeq(scope, taskId) >= throughSeq) { this.db.exec('COMMIT'); return }
      const now = Date.now()
      for (const proposal of proposals) {
        const id = digest(JSON.stringify([scope, taskId, proposal.name]))
        const previous = this.read(scope, taskId, id)
        // A saved decision is durable across later turns, including newly worded proposals.
        if (previous && previous.status !== 'candidate') continue
        if (this.db.prepare("SELECT id FROM suggestions WHERE scope=? AND name=? AND status IN ('ignored','created') LIMIT 1").get(scope, proposal.name)) continue
        this.db.prepare(`INSERT INTO suggestions(id,scope,task_id,name,description,content,version,created_at,through_seq,seqs,status)
          VALUES(?,?,?,?,?,?,?,?,?,?,'candidate') ON CONFLICT(id) DO UPDATE SET description=excluded.description,content=excluded.content,
          version=suggestions.version+1,through_seq=excluded.through_seq,seqs=excluded.seqs`)
          .run(id, scope, taskId, proposal.name, proposal.description, proposal.content, 1, now, throughSeq, JSON.stringify(proposal.seqs))
      }
      this.db.prepare('INSERT INTO observations VALUES(?,?,?) ON CONFLICT(scope,task_id) DO UPDATE SET through_seq=excluded.through_seq').run(scope, taskId, throughSeq)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  decide(scope: string, taskId: string, id: string, version: number, status: 'created' | 'ignored'): boolean {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.read(scope, taskId, id)
      const updated = this.db.prepare("UPDATE suggestions SET status=?,version=version+1 WHERE scope=? AND task_id=? AND id=? AND version=? AND status='candidate'").run(status, scope, taskId, id, version).changes === 1
      if (updated && row) this.db.prepare("UPDATE suggestions SET status=?,version=version+1 WHERE scope=? AND name=? AND status='candidate'").run(status, scope, row.name)
      this.db.exec('COMMIT')
      return updated
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  close(): void { this.db.close() }
}
