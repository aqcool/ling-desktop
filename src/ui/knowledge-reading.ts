import type { LingKnowledgeService } from '../runtime/knowledge.js'
import type { KnowledgeScopeInput } from './useKnowledge.js'

export type KnowledgeView = 'wiki' | 'card' | 'summary' | 'code' | 'graph' | 'reference' | 'memory' | 'map'
export interface ReadingPlace { documentId?: string; scrollTop: number; configure: boolean }
export interface ReadingSession { places: Partial<Record<KnowledgeView, ReadingPlace>>; positions: Record<string, number> }
// Renderer-session preferences only. Isolate by runtime/profile and scope; store no document text.
const sessions = new WeakMap<LingKnowledgeService, Map<string, ReadingSession>>()
export function knowledgeReadingSession(service: LingKnowledgeService | undefined, scope: KnowledgeScopeInput): ReadingSession {
  if (!service) return { places: {}, positions: {} }
  let cache = sessions.get(service)
  if (!cache) { cache = new Map(); sessions.set(service, cache) }
  const key = JSON.stringify([scope.workspaceId, scope.taskId, scope.libraryId])
  const saved = cache.get(key)
  if (saved) { cache.delete(key); cache.set(key, saved); return saved }
  const session: ReadingSession = { places: {}, positions: {} }
  cache.set(key, session)
  if (cache.size > 100) cache.delete(cache.keys().next().value!)
  return session
}
