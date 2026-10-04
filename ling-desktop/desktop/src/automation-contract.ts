import { z } from 'zod'
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { AutomationRequest, AutomationResponse, AutomationSpec } from 'ling-desktop/runtime'
const id = z.string().min(1).max(128),
  timestamp = z.number().int().min(0)
const model = z
  .object({
    provider: id,
    model: z.string().min(1).max(256),
    reasoningEffort: z.string().max(128).optional(),
  })
  .strict()
const calendar = z
  .object({
    kind: z.enum(['daily', 'weekly']),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z
      .string()
      .max(128)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone })
          return true
        } catch {
          return false
        }
      }, '时区无效。'),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  })
  .strict()
  .refine((s) => s.kind !== 'weekly' || s.weekdays.length > 0, '请选择执行日期。')
const schedule = z.union([
  calendar,
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(5).max(525600) }).strict(),
  z.object({ kind: z.literal('once'), at: timestamp }).strict(),
])
export const automationSpecSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(32000),
    workspaceId: id.nullable(),
    model: model.nullable(),
    schedule,
    expiresAt: timestamp.nullable(),
    permission: z.enum(['read-only', 'workspace-write', 'danger-full-access']),
    output: z.enum(['separate', 'reuse']),
    missed: z.enum(['skip', 'latest']),
    enabled: z.boolean(),
  })
  .strict()
const plan = automationSpecSchema.safeExtend({
  id,
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  nextAt: timestamp.nullable(),
  taskId: id.nullable(),
  archived: z.boolean(),
})
const run = z
  .object({
    id,
    planId: id,
    spec: automationSpecSchema,
    scheduledAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: z.enum([
      'queued',
      'running',
      'waiting-approval',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
      'skipped',
    ]),
    taskId: id,
    requestId: id,
    summary: z.string(),
    cancelRequested: z.boolean().optional(),
    admitted: z.boolean().optional(),
    retryOf: id.optional(),
  })
  .strict()
export const automationRequestSchema: z.ZodType<AutomationRequest> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot') }).strict(),
  z
    .object({
      type: z.literal('save'),
      spec: automationSpecSchema,
      id: id.optional(),
      version: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum(['toggle', 'remove']),
      id,
      version: z.number().int().positive(),
      enabled: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('run'), id }).strict(),
  z.object({ type: z.enum(['retry', 'cancel']), runId: id }).strict(),
  z.object({ type: z.literal('settings'), keepAwake: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('draft'),
      text: z.string().trim().min(1).max(8000),
      model,
      timeZone: z.string().max(128),
    })
    .strict(),
])
const response: z.ZodType<AutomationResponse> = z
  .object({
    snapshot: z
      .object({ plans: z.array(plan), runs: z.array(run), keepAwake: z.boolean() })
      .strict()
      .optional(),
    plan: plan.optional(),
    run: run.optional(),
    draft: automationSpecSchema.optional(),
  })
  .strict()
export interface LingAutomationRemote {
  request(request: AutomationRequest, signal?: AbortSignal): Promise<RemoteResult<AutomationResponse>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    lingAutomation: LingAutomationRemote
  }
  interface TypertRemoteMap {
    'lingAutomation/request': LingAutomationRemote['request']
  }
}
const codec = (name: string, schema: z.ZodType) => ({
  mode: 'strict' as const,
  typeSymbol: `ling-desktop-host/automation#${name}`,
  create: () => schema,
})
const descriptors: readonly InvocationDescriptor[] = [
  {
    id: 'ling-desktop-host/automation#lingAutomation/request',
    service: 'lingAutomation',
    namespace: 'lingAutomation',
    method: 'request',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'request', wire: 'request', source: 'json', codec: codec('request', automationRequestSchema) },
    ],
    cancellation: { parameter: 'signal' },
    result: codec('result', response),
  },
]
export const LING_AUTOMATION_REMOTE: TypertRemoteContribution = {
  package: 'ling-desktop-host/automation',
  descriptors,
}
export const LING_AUTOMATION_HOST: TypertContribution = {
  package: 'ling-desktop-host/automation',
  face: 'host',
  schemas: [],
  invocations: descriptors,
  model: {
    services: [
      {
        key: 'lingAutomation',
        exportName: 'LingAutomationController',
        summary: 'Local persistent automation plans and execution history.',
        tags: [],
        members: [],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}
