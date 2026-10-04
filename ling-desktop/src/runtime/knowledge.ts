import type { LingReadResult } from './contract.js'

export type KnowledgeKind = 'memory' | 'summary' | 'wiki' | 'reference' | 'card'
export type KnowledgeState = 'active' | 'candidate' | 'stale' | 'archived'
export interface KnowledgeSource {
  kind: 'code' | 'session' | 'manual'
  label: string
  path?: string
  line?: number
  column?: number
  endLine?: number
  hash?: string
  commit?: string
  sessionId?: string
  seq?: number
  throughSeq?: number
}
export interface KnowledgeBinding {
  workspaceId: string | null
  taskId?: string
  scope: string
  label: string
}
export interface WikiOptions {
  language: 'zh-CN' | 'en'
  autoUpdate: boolean
  agentReference: boolean
}
export const wikiDefaults: WikiOptions = {
  language: 'zh-CN',
  autoUpdate: false,
  agentReference: true,
}
export interface KnowledgeLibrary {
  id: string
  scope: string
  name: string
  description: string
  workspaceId: string | null
  taskId?: string
  scopeLabel: string
  version: number
  updatedAt: number
  documents: number
  access?: 'all' | 'selected'
  bindings?: KnowledgeBinding[]
}
export interface KnowledgeDocument {
  id: string
  scope: string
  kind: KnowledgeKind
  title: string
  body: string
  sources: KnowledgeSource[]
  state: KnowledgeState
  version: number
  manual: boolean
  libraryId?: string
  parentId?: string
  position?: number
  updatedAt: number
}
export interface KnowledgeNode {
  id: string
  label: string
  kind: 'module' | 'file' | 'symbol'
  parent?: string
  source?: KnowledgeSource
}
export interface KnowledgeEdge {
  id: string
  source: string
  target: string
  kind: 'contains' | 'imports' | 'calls'
  evidence: 'syntax' | 'semantic'
}
export interface KnowledgeJob {
  id: string
  scope: string
  kind: 'index' | 'summary' | 'wiki'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  message?: string
  createdAt: number
  updatedAt: number
}
export interface KnowledgeSettings {
  projectMemory: boolean
  globalMemory: boolean
  autoSummary: boolean
  autoWiki: boolean
  provider: string
  model: string
}
export interface KnowledgeHit {
  id: string
  kind: KnowledgeKind | 'code' | 'history'
  title: string
  snippet: string
  source?: KnowledgeSource
  state?: KnowledgeState
}
export interface KnowledgeSnapshot {
  documents: KnowledgeDocument[]
  libraries?: KnowledgeLibrary[]
  jobs: KnowledgeJob[]
  settings: KnowledgeSettings
  wikiOptions?: WikiOptions
  navigation?: boolean
  indexedFiles: number
  indexedAt: number | null
}
export type KnowledgeRequest = {
  workspaceId: string | null
  taskId?: string
  libraryId?: string
} & (
  | { type: 'snapshot' }
  | { type: 'catalog' }
  | {
      type: 'saveLibrary'
      library: {
        id?: string
        version?: number
        name: string
        description: string
        access?: 'all' | 'selected'
        bindings?: { workspaceId: string | null; taskId?: string }[]
      }
    }
  | { type: 'deleteLibrary'; id: string; version: number }
  | {
      type: 'search'
      query: string
      kind?: KnowledgeHit['kind']
      libraryId?: string
    }
  | { type: 'read'; id: string }
  | {
      type: 'save'
      document: {
        id?: string
        kind: KnowledgeKind
        title: string
        body: string
        version?: number
        sources: KnowledgeSource[]
        state?: KnowledgeState
        libraryId?: string
        parentId?: string
        position?: number
      }
    }
  | { type: 'remove'; id: string; version: number }
  | { type: 'index' }
  | { type: 'summarize'; sessionId: string }
  | { type: 'wiki' }
  | { type: 'wikiOptions'; options: WikiOptions }
  | { type: 'graph'; nodeId?: string }
  | { type: 'source'; source: KnowledgeSource }
  | {
      type: 'navigate'
      source: KnowledgeSource
      operation: 'goToDefinition' | 'findReferences' | 'goToImplementation'
    }
  | { type: 'settings'; settings: KnowledgeSettings }
  | { type: 'cancel' | 'retry'; jobId: string }
  | { type: 'export'; id?: string; kind?: KnowledgeKind; libraryId?: string }
)
export interface KnowledgeResponse {
  libraries?: KnowledgeLibrary[]
  library?: KnowledgeLibrary
  snapshot?: KnowledgeSnapshot
  hits?: KnowledgeHit[]
  document?: KnowledgeDocument
  revisions?: KnowledgeDocument[]
  nodes?: KnowledgeNode[]
  edges?: KnowledgeEdge[]
  text?: string
  stale?: boolean
  job?: KnowledgeJob
}
export interface LingKnowledgeService {
  request(
    request: KnowledgeRequest,
    signal?: AbortSignal,
  ): Promise<LingReadResult<KnowledgeResponse>>
}
export const knowledgeDefaults: KnowledgeSettings = {
  projectMemory: true,
  globalMemory: false,
  autoSummary: false,
  autoWiki: false,
  provider: '',
  model: '',
}
