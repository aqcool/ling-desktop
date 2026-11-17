import { z } from "zod";

export const LOCAL_TTFT_MAX_DETAILS = 64;
export const LOCAL_TTFT_PREPARATION_STAGES = [
  "context",
  "hooks",
  "persistence",
  "compaction",
  "mcp",
  "tools",
  "request_assembly",
] as const;
const diagnosticTime = z.number().finite().nonnegative();
export const localTtftDetailSchema = z
  .object({
    id: z.string().min(1).max(128),
    stage: z.enum([...LOCAL_TTFT_PREPARATION_STAGES, "attempt", "retry_wait", "user_confirmation"]),
    start: diagnosticTime,
    end: diagnosticTime.optional(),
    outcome: z.enum(["completed", "failed", "cancelled", "first_output"]).optional(),
    requestId: z.string().min(1).max(128).optional(),
    logicalCallId: z.string().min(1).max(128).optional(),
    role: z.enum(["response", "preparation"]).optional(),
    source: z.enum(["renderer", "cli"]),
  })
  .strict()
  .refine((value) => value.end === undefined || value.end >= value.start);
export type LocalTtftDetail = z.infer<typeof localTtftDetailSchema>;
const time = z.number().finite().nonnegative();
const identifier = z.string().min(1).max(128);
export const localTtftContextSchema = z
  .object({
    version: z.literal(1),
    observationId: z.string().uuid(),
    localOnly: z.literal(true).optional(),
  })
  .strict();
export type LocalTtftContext = z.infer<typeof localTtftContextSchema>;
export const localTtftClockSchema = z
  .object({ instanceId: identifier, receivedAt: time, sentAt: time })
  .strict();
export type LocalTtftClock = z.infer<typeof localTtftClockSchema>;
export const localTtftOutputKindSchema = z.enum(["text", "reasoning", "tool"]);
export type LocalTtftOutputKind = z.infer<typeof localTtftOutputKindSchema>;
export const localTtftFactsSchema = z
  .object({
    ...localTtftContextSchema.shape,
    instanceId: identifier,
    commandId: identifier,
    sessionId: identifier.optional(),
    turnId: identifier.optional(),
    productTurnId: identifier.optional(),
    queryId: identifier.optional(),
    requestId: identifier.optional(),
    logicalCallId: identifier.optional(),
    cliVersion: identifier.optional(),
    provider: identifier.optional(),
    model: identifier.optional(),
    details: z.array(localTtftDetailSchema).max(LOCAL_TTFT_MAX_DETAILS).optional(),
    truncated: z.boolean().optional(),
    revision: z.number().int().nonnegative().optional(),
    sendMode: z.enum(["idle", "queued", "guided"]).optional(),
    clockInvalid: z.boolean().optional(),
    receivedAt: time,
    admittedAt: time.optional(),
    executionAt: time.optional(),
    requestAt: time.optional(),
    outputAt: time.optional(),
    outputKind: localTtftOutputKindSchema.optional(),
    terminal: z.enum(["completed", "failed", "cancelled", "rejected", "interrupted"]).optional(),
    excluded: z.enum(["busy", "retry", "unsupported", "failed", "capacity"]).optional(),
  })
  .strict();
export type LocalTtftFacts = z.infer<typeof localTtftFactsSchema>;
