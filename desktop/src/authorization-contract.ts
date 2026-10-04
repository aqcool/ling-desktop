import type { RemoteResult, TypertRemoteContribution, InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { z } from 'zod'

export interface LingAuthorizationMethodView {
  readonly id: string
  readonly label: string
}

export interface LingAuthorizationEntryView {
  readonly key: string
  readonly providerId: string
  readonly label: string
  readonly methods: readonly LingAuthorizationMethodView[]
  readonly configured: boolean
  readonly writable: boolean
  readonly inFlight: boolean
}

export interface LingAuthorizationPromptView {
  readonly kind: 'text' | 'secret' | 'select'
  readonly message: string
  readonly placeholder?: string
  readonly options?: readonly {
    readonly id: string
    readonly label: string
    readonly description?: string
  }[]
}

export type LingAuthorizationFrame =
  | {
      readonly seq: number
      readonly type: 'notice'
      readonly message: string
      readonly url?: string
      readonly code?: string
    }
  | {
      readonly seq: number
      readonly type: 'prompt'
      readonly promptId: string
      readonly prompt: LingAuthorizationPromptView
    }
  | {
      readonly seq: number
      readonly type: 'prompt-dismissed'
      readonly promptId: string
    }
  | {
      readonly seq: number
      readonly type: 'settled'
      readonly status: 'authorized' | 'cancelled'
    }
  | {
      readonly seq: number
      readonly type: 'failed'
      readonly message: string
    }

export interface LingAuthorizationPollResult {
  readonly events: readonly LingAuthorizationFrame[]
  readonly done: boolean
}

export interface LingAuthorizationRemote {
  list(): Promise<RemoteResult<readonly LingAuthorizationEntryView[]>>
  start(key: string, method: string): Promise<RemoteResult<{ readonly attemptId: string }>>
  poll(attemptId: string, afterSeq: number, signal?: AbortSignal): Promise<RemoteResult<LingAuthorizationPollResult>>
  answer(attemptId: string, promptId: string, value: string): Promise<RemoteResult<{ readonly ok: true }>>
  cancel(attemptId: string): Promise<RemoteResult<{ readonly ok: true }>>
  signOut(key: string): Promise<RemoteResult<{ readonly ok: true }>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6c696e67417574686f72697a6174696f6e extends LingAuthorizationRemote {}
  interface TypertRemoteMap {
    'lingAuthorization/list': LingAuthorizationRemote['list']
    'lingAuthorization/start': LingAuthorizationRemote['start']
    'lingAuthorization/poll': LingAuthorizationRemote['poll']
    'lingAuthorization/answer': LingAuthorizationRemote['answer']
    'lingAuthorization/cancel': LingAuthorizationRemote['cancel']
    'lingAuthorization/signOut': LingAuthorizationRemote['signOut']
  }
  interface TypertRemoteNamespaceMap {
    lingAuthorization: TypertRemoteNamespace$6c696e67417574686f72697a6174696f6e
  }
}

const methodSchema = z.object({ id: z.string().min(1), label: z.string().min(1) }).strict()
const entrySchema = z.object({
  key: z.string().min(1),
  providerId: z.string().min(1),
  label: z.string().min(1),
  methods: z.array(methodSchema),
  configured: z.boolean(),
  writable: z.boolean(),
  inFlight: z.boolean(),
}).strict()
const promptOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
}).strict()
const promptSchema = z.object({
  kind: z.enum(['text', 'secret', 'select']),
  message: z.string(),
  placeholder: z.string().optional(),
  options: z.array(promptOptionSchema).optional(),
}).strict()
const frameSchema = z.discriminatedUnion('type', [
  z.object({
    seq: z.number().int().positive(), type: z.literal('notice'), message: z.string(),
    url: z.string().optional(), code: z.string().optional(),
  }).strict(),
  z.object({
    seq: z.number().int().positive(), type: z.literal('prompt'), promptId: z.string().min(1), prompt: promptSchema,
  }).strict(),
  z.object({
    seq: z.number().int().positive(), type: z.literal('prompt-dismissed'), promptId: z.string().min(1),
  }).strict(),
  z.object({
    seq: z.number().int().positive(), type: z.literal('settled'), status: z.enum(['authorized', 'cancelled']),
  }).strict(),
  z.object({
    seq: z.number().int().positive(), type: z.literal('failed'), message: z.string(),
  }).strict(),
])
const pollResultSchema = z.object({ events: z.array(frameSchema), done: z.boolean() }).strict()
const attemptSchema = z.object({ attemptId: z.string().uuid() }).strict()
const receiptSchema = z.object({ ok: z.literal(true) }).strict()

function codec(name: string, schema: z.ZodType) {
  return { mode: 'strict' as const, typeSymbol: `ling-desktop-host#${name}`, create: () => schema }
}

function descriptor(
  method: string,
  parameters: InvocationDescriptor['parameters'],
  result: z.ZodType,
  cancellable = false,
): InvocationDescriptor {
  return {
    id: `ling-desktop-host#lingAuthorization/${method}`,
    service: 'lingAuthorization',
    namespace: 'lingAuthorization',
    method,
    invocation: { kind: 'direct' },
    parameters,
    ...(cancellable ? { cancellation: { parameter: 'signal' as const } } : {}),
    result: codec(`lingAuthorization/${method}:result`, result),
  }
}

function parameter(method: string, name: string, schema: z.ZodType) {
  return {
    name,
    wire: name,
    source: 'json' as const,
    codec: codec(`lingAuthorization/${method}:${name}`, schema),
  }
}

export const LING_AUTHORIZATION_DESCRIPTORS: readonly InvocationDescriptor[] = [
  descriptor('list', [], z.array(entrySchema)),
  descriptor('start', [
    parameter('start', 'key', z.string().min(1)),
    parameter('start', 'method', z.string()),
  ], attemptSchema),
  descriptor('poll', [
    parameter('poll', 'attemptId', z.string().uuid()),
    parameter('poll', 'afterSeq', z.number().int().nonnegative()),
  ], pollResultSchema, true),
  descriptor('answer', [
    parameter('answer', 'attemptId', z.string().uuid()),
    parameter('answer', 'promptId', z.string().uuid()),
    parameter('answer', 'value', z.string()),
  ], receiptSchema),
  descriptor('cancel', [parameter('cancel', 'attemptId', z.string().uuid())], receiptSchema),
  descriptor('signOut', [parameter('signOut', 'key', z.string().min(1))], receiptSchema),
]

export const LING_AUTHORIZATION_REMOTE: TypertRemoteContribution = {
  package: 'ling-desktop-host',
  descriptors: LING_AUTHORIZATION_DESCRIPTORS,
}

export const LING_AUTHORIZATION_HOST: TypertContribution = {
  package: 'ling-desktop-host',
  face: 'host',
  schemas: [],
  invocations: LING_AUTHORIZATION_DESCRIPTORS,
  model: {
    services: [{
      key: 'lingAuthorization',
      exportName: 'LingAuthorizationController',
      summary: 'LING authorization interaction bridge.',
      tags: [],
      members: [],
      types: [],
    }],
    events: [],
    objects: [],
  },
}
