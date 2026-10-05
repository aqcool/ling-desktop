import { z } from 'zod'
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { KnowledgeRequest, KnowledgeResponse } from 'ling-desktop/runtime'
export const sourceSchema = z
  .object({
    kind: z.enum(['code', 'session', 'manual']),
    label: z.string().min(1).max(512),
    path: z.string().max(4096).optional(),
    line: z.number().int().min(1).optional(),
    column: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
    hash: z.string().max(128).optional(),
    commit: z.string().max(128).optional(),
    sessionId: z.string().max(128).optional(),
    seq: z.number().int().min(0).optional(),
    throughSeq: z.number().int().min(0).optional(),
  })
  .strict()
export const settingsSchema = z
  .object({
    projectMemory: z.boolean(),
    globalMemory: z.boolean(),
    autoSummary: z.boolean(),
    autoWiki: z.boolean(),
    provider: z.string().max(128),
    model: z.string().max(256),
  })
  .strict()
const scope = {
  workspaceId: z.string().min(1).max(128).nullable(),
  taskId: z.string().min(1).max(128).optional(),
  libraryId: z.string().min(1).max(512).optional(),
}
const id = z.string().min(1).max(512)
const placement = {
  libraryId: id.optional(),
  parentId: id.optional(),
  position: z.number().int().min(0).max(10000).optional(),
}
const wikiOptionsSchema = z
  .object({
    language: z.enum(['zh-CN', 'en']),
    autoUpdate: z.boolean(),
    agentReference: z.boolean(),
  })
  .strict()
const bindingInput = z
  .object({ workspaceId: scope.workspaceId, taskId: scope.taskId })
  .strict()
  .refine(
    (value) => value.workspaceId !== null || !!value.taskId,
    '请选择工作区。',
  )
const librarySchema = z
  .object({
    id,
    scope: z.string(),
    name: z.string(),
    description: z.string(),
    workspaceId: z.string().nullable(),
    taskId: z.string().optional(),
    scopeLabel: z.string(),
    version: z.number().int(),
    updatedAt: z.number(),
    documents: z.number().int(),
    access: z.enum(['all', 'selected']).optional(),
    bindings: z
      .array(
        z
          .object({
            workspaceId: scope.workspaceId,
            taskId: scope.taskId,
            scope: z.string(),
            label: z.string(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
export const knowledgeRequestSchema: z.ZodType<KnowledgeRequest> =
  z.discriminatedUnion('type', [
    z.object({ ...scope, type: z.literal('snapshot') }).strict(),
    z.object({ ...scope, type: z.literal('catalog') }).strict(),
    z
      .object({
        ...scope,
        type: z.literal('saveLibrary'),
        library: z
          .object({
            id: id.optional(),
            version: z.number().int().min(1).optional(),
            name: z.string().trim().min(1).max(120),
            description: z.string().trim().max(1000),
            access: z.enum(['all', 'selected']).optional(),
            bindings: z.array(bindingInput).max(100).optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...scope,
        type: z.literal('deleteLibrary'),
        id,
        version: z.number().int().min(1),
      })
      .strict(),
    z
      .object({
        ...scope,
        type: z.literal('search'),
        query: z.string().trim().min(1).max(256),
        kind: z
          .enum([
            'memory',
            'summary',
            'wiki',
            'reference',
            'card',
            'code',
            'history',
          ])
          .optional(),
        libraryId: id.optional(),
      })
      .strict(),
    z.object({ ...scope, type: z.literal('read'), id }).strict(),
    z
      .object({
        ...scope,
        type: z.literal('save'),
        document: z
          .object({
            ...placement,
            id: id.optional(),
            kind: z.enum(['memory', 'summary', 'wiki', 'reference', 'card']),
            title: z.string().trim().min(1).max(200),
            body: z.string().trim().min(1).max(128000),
            version: z.number().int().min(1).optional(),
            sources: z.array(sourceSchema).min(1).max(500),
            state: z
              .enum(['active', 'candidate', 'stale', 'archived'])
              .optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...scope,
        type: z.literal('remove'),
        id,
        version: z.number().int().min(1),
      })
      .strict(),
    z.object({ ...scope, type: z.literal('index') }).strict(),
    z
      .object({
        ...scope,
        type: z.literal('summarize'),
        sessionId: z.string().min(1).max(128),
      })
      .strict(),
    z.object({ ...scope, type: z.literal('wiki') }).strict(),
    z
      .object({
        ...scope,
        type: z.literal('wikiOptions'),
        options: wikiOptionsSchema,
      })
      .strict(),
    z
      .object({ ...scope, type: z.literal('graph'), nodeId: id.optional() })
      .strict(),
    z.object({ ...scope, type: z.literal('knowledgeMap'), focusId: z.string().min(1).max(10000).optional(), query: z.string().trim().max(256).optional() }).strict(),
    z
      .object({ ...scope, type: z.literal('source'), source: sourceSchema })
      .strict(),
    z
      .object({
        ...scope,
        type: z.literal('navigate'),
        source: sourceSchema,
        operation: z.enum([
          'goToDefinition',
          'findReferences',
          'goToImplementation',
        ]),
      })
      .strict(),
    z
      .object({
        ...scope,
        type: z.literal('settings'),
        settings: settingsSchema,
      })
      .strict(),
    z
      .object({ ...scope, type: z.enum(['cancel', 'retry']), jobId: id })
      .strict(),
    z
      .object({
        ...scope,
        type: z.literal('export'),
        id: id.optional(),
        kind: z
          .enum(['memory', 'summary', 'wiki', 'reference', 'card'])
          .optional(),
        libraryId: id.optional(),
      })
      .strict(),
  ])
const documentSchema = z
  .object({
    ...placement,
    id: z.string(),
    scope: z.string(),
    kind: z.enum(['memory', 'summary', 'wiki', 'reference', 'card']),
    title: z.string(),
    body: z.string(),
    sources: z.array(sourceSchema),
    state: z.enum(['active', 'candidate', 'stale', 'archived']),
    version: z.number().int(),
    manual: z.boolean(),
    updatedAt: z.number(),
  })
  .strict()
const jobSchema = z.object({
  id: z.string(),
  scope: z.string(),
  kind: z.enum(['index', 'summary', 'wiki']),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  message: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
const responseSchema: z.ZodType<KnowledgeResponse> = z
  .object({
    libraries: z.array(librarySchema).optional(),
    library: librarySchema.optional(),
    snapshot: z
      .object({
        libraries: z.array(librarySchema).optional(),
        documents: z.array(documentSchema),
        jobs: z.array(jobSchema),
        settings: settingsSchema,
        wikiOptions: wikiOptionsSchema.optional(),
        navigation: z.boolean().optional(),
        indexedFiles: z.number().int(),
        indexedAt: z.number().nullable(),
      })
      .strict()
      .optional(),
    document: documentSchema.optional(),
    revisions: z.array(documentSchema).optional(),
    hits: z
      .array(
        z
          .object({
            id: z.string(),
            kind: z.enum([
              'memory',
              'summary',
              'wiki',
              'reference',
              'card',
              'code',
              'history',
            ]),
            title: z.string(),
            snippet: z.string(),
            source: sourceSchema.optional(),
            state: z
              .enum(['active', 'candidate', 'stale', 'archived'])
              .optional(),
          })
          .strict(),
      )
      .optional(),
    nodes: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            kind: z.enum(['module', 'file', 'symbol']),
            parent: z.string().optional(),
            source: sourceSchema.optional(),
          })
          .strict(),
      )
      .optional(),
    edges: z
      .array(
        z
          .object({
            id: z.string(),
            source: z.string(),
            target: z.string(),
            kind: z.enum(['contains', 'imports', 'calls']),
            evidence: z.enum(['syntax', 'semantic']),
          })
          .strict(),
      )
      .optional(),
    text: z.string().optional(),
    map: z.object({
      nodes: z.array(z.object({
        id: z.string(), label: z.string(),
        kind: z.enum(['wiki', 'card', 'summary', 'reference', 'file', 'session']),
        documentId: z.string().optional(),
        state: z.enum(['active', 'candidate', 'stale', 'archived']).optional(),
        source: sourceSchema.optional(),
      }).strict()),
      edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), kind: z.enum(['contains', 'derived', 'cites', 'links']), citation: sourceSchema.optional() }).strict()),
      totalNodes: z.number().int().nonnegative(), totalEdges: z.number().int().nonnegative(), truncated: z.boolean(),
    }).strict().optional(),
    startLine: z.number().int().positive().optional(),
    stale: z.boolean().optional(),
    job: jobSchema.optional(),
  })
  .strict()
export interface LingKnowledgeRemote {
  request(
    request: KnowledgeRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<KnowledgeResponse>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    lingKnowledge: LingKnowledgeRemote
  }
  interface TypertRemoteMap {
    'lingKnowledge/request': LingKnowledgeRemote['request']
  }
}
const codec = (name: string, schema: z.ZodType) => ({
  mode: 'strict' as const,
  typeSymbol: `ling-desktop-host/knowledge#${name}`,
  create: () => schema,
})
const descriptors: readonly InvocationDescriptor[] = [
  {
    id: 'ling-desktop-host/knowledge#lingKnowledge/request',
    service: 'lingKnowledge',
    namespace: 'lingKnowledge',
    method: 'request',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: codec('request', knowledgeRequestSchema),
      },
    ],
    cancellation: { parameter: 'signal' },
    result: codec('result', responseSchema),
  },
]
export const LING_KNOWLEDGE_REMOTE: TypertRemoteContribution = {
  package: 'ling-desktop-host/knowledge',
  descriptors,
}
export const LING_KNOWLEDGE_HOST: TypertContribution = {
  package: 'ling-desktop-host/knowledge',
  face: 'host',
  schemas: [],
  invocations: descriptors,
  model: {
    services: [
      {
        key: 'lingKnowledge',
        exportName: 'LingKnowledgeController',
        summary:
          'Profile-scoped knowledge, source retrieval and background indexing.',
        tags: [],
        members: [],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}
