import { Output, jsonSchema } from "ai";
import type { ModelToolChoice } from "@zcode/contracts";
import type { EnvRecord } from "./model-execution.js";
import { toolSearchHeaders } from "./tool-search.js";
import { toAiSdkMessages } from "./transform.js";
import { toAiSdkTools } from "./tool-transform.js";
import type {
  AiSdkGenerateTextOptions,
  AiSdkModelTextRequest,
  AiSdkStreamTextOptions,
  ResolvedAiSdkModel,
} from "./runner-runtime.js";
import { createModelRequestAttributionHeaders, type ModelStatusContext } from "./runner-status.js";
import { withoutRetiredModelHeaders } from "./model-request-headers.js";

type ExperimentalIncludeWithResponseBody = {
  requestBody?: boolean;
  responseBody?: boolean;
};

/** zcode-plan 业务码常只出现在 finish chunk 的 response.body，流式路径需显式开启。 */
export function shouldIncludeStreamResponseBody(resolved: ResolvedAiSdkModel): boolean {
  return (
    resolved.providerKind === "openai-compatible" && resolved.accountAccess?.mode === "start-plan"
  );
}

function mergeRequestHeaders(
  providerHeaders: Record<string, string> | undefined,
  attributionHeaders: Record<string, string>,
): Record<string, string> {
  return {
    ...withoutRetiredModelHeaders(providerHeaders),
    ...attributionHeaders,
  };
}

function prepareModelTools(request: AiSdkModelTextRequest, resolved: ResolvedAiSdkModel) {
  return toAiSdkTools(request.tools, {
    toolSearchEnabled: request.toolSearchEnabled,
    providerKind: resolved.providerKind,
    modelId: resolved.modelId,
    requiresMfjsToolSchema: resolved.properties.requiresMfjsToolSchema,
    supportsNativeWebSearch: resolved.properties.supportsNativeWebSearch,
    // Codex Responses 会隐式尝试严格编译；动态键工具的 propertyNames 会让整轮请求被拒。
    defaultStrict: resolved.chatGptSubscription ? false : undefined,
  });
}

export function createGenerateTextOptions(input: {
  anthropicMetadataUserId?: string;
  env?: EnvRecord;
  includeModelIO: boolean;
  request: AiSdkModelTextRequest;
  resolved: ResolvedAiSdkModel;
  statusContext: ModelStatusContext;
}): AiSdkGenerateTextOptions {
  const { messages, providerOptions } = prepareModelPrompt(input);
  const providerOptionsWithMetadata = mergeAnthropicRequestMetadata({
    metadataUserId: input.anthropicMetadataUserId,
    providerKind: input.resolved.providerKind,
    providerOptions,
  });
  const requestProviderOptions = withNativeGenerateOutputFormat({
    providerOptions: providerOptionsWithMetadata,
    responseJsonSchema: input.request.responseJsonSchema,
    resolved: input.resolved,
  });
  return removeUndefined({
    model: input.resolved.model,
    messages,
    tools: prepareModelTools(input.request, input.resolved),
    toolChoice: toAiSdkToolChoice(input.request.toolChoice),
    temperature: input.request.temperature,
    topP: input.request.topP,
    topK: input.request.topK,
    presencePenalty: input.request.presencePenalty,
    frequencyPenalty: input.request.frequencyPenalty,
    stopSequences: input.request.stopSequences,
    seed: input.request.seed,
    output: input.request.responseJsonSchema
      ? Output.object({ schema: jsonSchema(input.request.responseJsonSchema) })
      : undefined,
    providerOptions: requestProviderOptions,
    abortSignal: input.request.abortSignal,
    headers: mergeRequestHeaders(
      toolSearchHeaders(input.resolved.headers, input.request.toolSearchEnabled),
      createModelRequestAttributionHeaders(input.statusContext),
    ),
    // ZCode owns system-message construction in core/context. Keep AI SDK from
    // printing its generic system-message warning to process stderr.
    allowSystemInMessages: true,
    maxRetries: 0,
    experimental_include: input.includeModelIO
      ? {
          requestBody: true,
          responseBody: true,
        }
      : undefined,
  }) as AiSdkGenerateTextOptions;
}

export function createStreamTextOptions(input: {
  anthropicMetadataUserId?: string;
  env?: EnvRecord;
  includeModelIO: boolean;
  request: AiSdkModelTextRequest;
  resolved: ResolvedAiSdkModel;
  statusContext: ModelStatusContext;
}): AiSdkStreamTextOptions {
  const { messages, providerOptions } = prepareModelPrompt(input);
  const requestProviderOptions = mergeAnthropicRequestMetadata({
    metadataUserId: input.anthropicMetadataUserId,
    providerKind: input.resolved.providerKind,
    providerOptions,
  });
  return removeUndefined({
    model: input.resolved.model,
    messages,
    tools: prepareModelTools(input.request, input.resolved),
    toolChoice: toAiSdkToolChoice(input.request.toolChoice),
    temperature: input.request.temperature,
    topP: input.request.topP,
    topK: input.request.topK,
    presencePenalty: input.request.presencePenalty,
    frequencyPenalty: input.request.frequencyPenalty,
    stopSequences: input.request.stopSequences,
    seed: input.request.seed,
    providerOptions: requestProviderOptions,
    abortSignal: input.request.abortSignal,
    headers: mergeRequestHeaders(
      toolSearchHeaders(input.resolved.headers, input.request.toolSearchEnabled),
      createModelRequestAttributionHeaders(input.statusContext),
    ),
    // ZCode owns system-message construction in core/context. Keep AI SDK from
    // printing its generic system-message warning to process stderr.
    allowSystemInMessages: true,
    maxRetries: 0,
    // AI SDK 会吞掉 Anthropic message_start 等 metadata 事件；compact 需要
    // 在 adapter 内观察 raw event 才能精确结束 SSE retry，raw chunk 不会上送 Core/UI。
    includeRawChunks: input.request.preserveProviderStreamBoundaries ? true : undefined,
    // zcode-plan 的业务码可能只在流式响应尾部 body 里，需保留 responseBody 供错误分类读取。
    experimental_include: createStreamExperimentalInclude(input),
  }) as AiSdkStreamTextOptions;
}

function createStreamExperimentalInclude(input: {
  includeModelIO: boolean;
  resolved: ResolvedAiSdkModel;
}): ExperimentalIncludeWithResponseBody | undefined {
  if (input.includeModelIO) {
    return {
      requestBody: true,
      responseBody: true,
    };
  }
  return shouldIncludeStreamResponseBody(input.resolved) ? { responseBody: true } : undefined;
}

function toAiSdkToolChoice(
  toolChoice?: ModelToolChoice,
): AiSdkGenerateTextOptions["toolChoice"] | undefined {
  return toolChoice as AiSdkGenerateTextOptions["toolChoice"] | undefined;
}

function prepareModelPrompt({
  request,
  resolved,
}: {
  request: AiSdkModelTextRequest;
  resolved: ResolvedAiSdkModel;
}) {
  let providerOptions =
    resolved.providerOptions || request.providerOptions
      ? { ...resolved.providerOptions, ...request.providerOptions }
      : undefined;
  let codexOptions: Record<string, unknown> | undefined;
  if (resolved.chatGptSubscription) {
    const openai = asPlainRecord(providerOptions?.openai);
    // 先以无存储模式转换历史，保留可重放的加密推理。
    codexOptions = {
      ...openai,
      include: [
        ...new Set([
          ...(Array.isArray(openai?.include) ? openai.include : []),
          "reasoning.encrypted_content",
        ]),
      ],
      store: false,
      conversation: undefined,
      previousResponseId: undefined,
    };
    providerOptions = { ...providerOptions, openai: codexOptions };
  }
  const messages = toAiSdkMessages(request.messages, {
    toolSearchEnabled: request.toolSearchEnabled,
    apiFormat: resolveProviderApiFormat(providerOptions),
    providerOptions,
    providerKind: resolved.providerKind,
    providerId: resolved.providerId,
    inputFormat: resolved.properties?.inputFormat,
  });
  if (!codexOptions) return { messages, providerOptions };

  const instructions =
    typeof codexOptions.instructions === "string" ? [codexOptions.instructions] : [];
  const history = messages.filter((message) => {
    if (message.role !== "system") return true;
    instructions.push(message.content);
    return false;
  });
  codexOptions.instructions =
    instructions.filter((text) => text.trim()).join("\n\n") || "You are a helpful assistant.";
  return { messages: history, providerOptions };
}

function withNativeGenerateOutputFormat(input: {
  providerOptions: Record<string, unknown> | undefined;
  resolved: ResolvedAiSdkModel;
  responseJsonSchema: AiSdkModelTextRequest["responseJsonSchema"];
}): Record<string, unknown> | undefined {
  if (!input.responseJsonSchema || input.resolved.providerKind !== "anthropic") {
    return input.providerOptions;
  }

  const anthropicOptions = asPlainRecord(input.providerOptions?.anthropic);
  return {
    ...input.providerOptions,
    // Lite role 的真实模型 ID 可能不在 AI SDK 的静态能力表中；
    // 显式 schema 必须继续生成目标 output_config，而不能退化成 JSON tool。
    anthropic: { ...anthropicOptions, structuredOutputMode: "outputFormat" },
  };
}

function mergeAnthropicRequestMetadata(input: {
  metadataUserId: string | undefined;
  providerKind: ResolvedAiSdkModel["providerKind"];
  providerOptions: Record<string, unknown> | undefined;
}): Record<string, unknown> | undefined {
  if (input.providerKind !== "anthropic" || input.metadataUserId === undefined) {
    return input.providerOptions;
  }

  const anthropicOptions = asPlainRecord(input.providerOptions?.anthropic) ?? {};
  const metadata = asPlainRecord(anthropicOptions.metadata) ?? {};
  return {
    ...input.providerOptions,
    anthropic: {
      ...anthropicOptions,
      metadata: {
        ...metadata,
        userId: input.metadataUserId,
      },
    },
  };
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function resolveProviderApiFormat(providerOptions?: Record<string, unknown>): string | undefined {
  const apiFormat = providerOptions?.apiFormat;
  return typeof apiFormat === "string" ? apiFormat : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}
