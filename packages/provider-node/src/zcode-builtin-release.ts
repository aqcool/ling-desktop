import { reportedReasoningEffortSchema } from "@zcode/shared/model-config";
import { z } from "zod";
import {
  parseZCodeBuiltinModelConfigRules,
  parseZCodeBuiltinProviderConfigRules,
  type ModelConfigRules,
  type ProviderConfigMap,
  type ProviderTemplateMap,
} from "@zcode/provider";

export const ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION = 1 as const;
const RETIRED_ZAPI_PROVIDER_ID = "builtin:zapi";

export interface ZCodeBuiltinConfigContent {
  readonly providers: ProviderConfigMap;
  readonly providerTemplates: ProviderTemplateMap;
  readonly modelConfigRules: ModelConfigRules;
}

export interface ZCodeBuiltinRelease {
  readonly schemaVersion: typeof ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION;
  readonly revision: number;
  readonly config: ZCodeBuiltinConfigContent;
}

const releaseSchema = z
  .object({
    schemaVersion: z.literal(ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    config: z
      .object({
        providerConfigRules: z.unknown(),
        modelConfigRules: z.unknown(),
      })
      .strict(),
  })
  .strict();

export function decodeZCodeBuiltinRelease(input: unknown): ZCodeBuiltinRelease {
  const parsed = releaseSchema.parse(input);
  const { providers, providerTemplates } = parseZCodeBuiltinProviderConfigRules(
    parsed.config.providerConfigRules,
  );
  // ZAPI 已退出产品，旧 Remote Release 或 LKG 不能在 Renderer 静态入口删除后
  // 又通过目标 Host Registry 将它重新发布。拒绝整份不兼容 Release，让 Source 回落到兼容候选。
  if (providers.has(RETIRED_ZAPI_PROVIDER_ID)) {
    throw new Error(`ZCode Built-in Release 包含已退出的 Provider: ${RETIRED_ZAPI_PROVIDER_ID}`);
  }
  return Object.freeze({
    schemaVersion: ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: parsed.revision,
    config: Object.freeze({
      providers,
      providerTemplates,
      modelConfigRules: parseZCodeBuiltinModelConfigRules(parsed.config.modelConfigRules),
    }),
  });
}

export function encodeZCodeBuiltinRelease(release: ZCodeBuiltinRelease): object {
  return {
    schemaVersion: ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: release.revision,
    config: {
      providerConfigRules: {
        templateRules: release.config.providerTemplates.toJSON(),
        providerRules: release.config.providers.toJSON(),
      },
      modelConfigRules: release.config.modelConfigRules.toZCodeBuiltinJSON(),
    },
  };
}

export function serializeZCodeBuiltinRelease(release: ZCodeBuiltinRelease): string {
  return JSON.stringify(encodeZCodeBuiltinRelease(release));
}

const modelsDevSourceByTemplate: Readonly<Record<string, string>> = {
  "zai-api": "zai",
  "zai-standard-api": "zai",
  "bigmodel-api": "zhipuai",
  "bigmodel-standard-api": "zhipuai",
  "moonshot-kimi": "moonshotai-cn",
  "kimi-code-cn": "kimi-code-plan-cn",
  "kimi-code-intl": "kimi-code-plan-global",
  minimax: "minimax",
  "minimax-m-plan-cn": "minimax-cn-coding-plan",
  deepseek: "deepseek",
  "qwen-alibaba-model-studio-cn": "alibaba-cn",
  "qwen-alibaba-model-studio-intl": "alibaba",
  "qwen-coding-plan-cn": "alibaba-coding-plan-cn",
  "qwen-token-plan-team-cn": "alibaba-token-plan-cn",
  "xiaomi-mimo": "xiaomi",
  "xiaomi-mimo-token-plan": "xiaomi-token-plan-cn",
  "tencent-tokenhub-cn": "tencent-tokenhub",
  "tencent-tokenhub-intl": "tencent-tokenhub",
  "volcengine-ark": "volcengine",
  "volcengine-coding-plan": "volcengine-coding-plan",
  stepfun: "stepfun",
  "stepfun-step-plan": "stepfun-step-plan",
  openai: "openai",
  anthropic: "anthropic",
  xai: "xai",
  "siliconflow-cn": "siliconflow-cn",
  openrouter: "openrouter",
  "opencode-go-responses": "opencode-go",
  "opencode-go-messages": "opencode-go",
  "opencode-go-chat": "opencode-go",
  "opencode-zen-responses": "opencode",
  "opencode-zen-messages": "opencode",
  "opencode-zen-chat": "opencode",
};

const directCatalogTemplates = new Set(["openai", "anthropic", "xai"]);
const modelsDevDocSchema = z.record(z.string(), z.unknown());
const modelsDevProviderSchema = z.object({ models: modelsDevDocSchema });
const tokenLimit = z.number().int().positive();
const modelsDevModelSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  tool_call: z.boolean().optional(),
  structured_output: z.boolean().optional(),
  modalities: z.object({ input: z.array(z.string()), output: z.array(z.string()) }).optional(),
  limit: z.object({ context: tokenLimit.optional(), output: tokenLimit.optional() }).optional(),
  reasoning_options: z
    .array(z.object({ type: z.string(), values: z.array(z.unknown()).optional() }))
    .optional(),
});

export function projectModelsDevCatalog(
  bundled: ZCodeBuiltinRelease,
  input: unknown,
): ZCodeBuiltinRelease {
  const catalog = modelsDevDocSchema.parse(input);
  const rules = bundled.config.modelConfigRules.toZCodeBuiltinJSON();
  const metadataRules: typeof rules.templateModelRules = [];
  const templateRules = bundled.config.providerTemplates.toJSON().map((template) => {
    const source = modelsDevSourceByTemplate[template.templateId];
    if (!source || template.config.access?.type !== "api-key") return template;
    const provider = modelsDevProviderSchema.safeParse(catalog[source]);
    if (!provider.success) return template;
    const ids = new Set(template.config.builtinModelIds ?? []);
    const mayAddModels = directCatalogTemplates.has(template.templateId);
    for (const [id, value] of Object.entries(provider.data.models)) {
      if (!mayAddModels && !ids.has(id)) continue;
      const result = modelsDevModelSchema.safeParse(value);
      if (!result.success || result.data.id !== id) continue;
      const model = result.data;
      if (!ids.has(id)) {
        if (!isDirectChatModel(id, model)) continue;
        ids.add(id);
      }
      metadataRules.push({
        templateId: template.templateId,
        inheritSubscription: false,
        modelId: id,
        config: modelsDevModelConfig(model, template.templateId === "openai"),
      });
    }
    const original = template.config.builtinModelIds ?? [];
    const additions = [...ids].filter((id) => !original.includes(id)).sort();
    return additions.length
      ? {
          ...template,
          config: { ...template.config, builtinModelIds: [...original, ...additions] },
        }
      : template;
  });
  if (metadataRules.length === 0) throw new Error("models.dev 目录没有匹配的模型");
  // 公开目录只读取能力字段。端点、鉴权和参数映射始终来自随包配置。
  const { providers, providerTemplates } = parseZCodeBuiltinProviderConfigRules({
    templateRules,
    providerRules: bundled.config.providers.toJSON(),
  });
  return {
    ...bundled,
    config: {
      providers,
      providerTemplates,
      modelConfigRules: parseZCodeBuiltinModelConfigRules({
        ...rules,
        // 修复原因：models.dev 规则作为默认基线放在前面，随包精选的 templateModelRules 放在后面保持更高优先级。
        templateModelRules: [
          ...metadataRules.sort(
            (a, b) =>
              a.templateId.localeCompare(b.templateId) || a.modelId.localeCompare(b.modelId),
          ),
          ...rules.templateModelRules,
        ],
      }),
    },
  };
}

// 排除 realtime / audio / 语音转写 / 向量 / 审核 / 生图生视频等非通用文本对话端点模型。
const NON_DIRECT_CHAT_MODEL_PATTERN =
  /(?:^|[-_.])(realtime|audio|transcribe|tts|whisper|embedding|moderation|dall-e|sora|search-preview)(?:$|[-_.])/iu;

function isDirectChatModel(id: string, model: z.infer<typeof modelsDevModelSchema>): boolean {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(id) &&
    !NON_DIRECT_CHAT_MODEL_PATTERN.test(id) &&
    model.tool_call === true &&
    model.modalities?.input.includes("text") === true &&
    model.modalities.output.includes("text") &&
    model.status !== "deprecated"
  );
}

function modelsDevModelConfig(
  model: z.infer<typeof modelsDevModelSchema>,
  openAiResponses: boolean,
) {
  const inputs = model.modalities?.input;
  const effort = openAiResponses
    ? model.reasoning_options?.find((option) => option.type === "effort")?.values
    : undefined;
  const levels = [
    ...new Set(
      effort?.filter(
        (value): value is string => reportedReasoningEffortSchema.safeParse(value).success,
      ),
    ),
  ];
  return {
    properties: {
      contextWindow: model.limit?.context,
      supportsToolCall: model.tool_call,
      supportsJsonSchemaOutput: model.structured_output,
      ...(inputs && {
        inputFormat: {
          supportsText: inputs.includes("text"),
          supportsImage: inputs.includes("image"),
          supportsVideo: inputs.includes("video"),
          supportsAudio: inputs.includes("audio"),
          supportsPdf: inputs.includes("pdf"),
        },
      }),
    },
    optionSpecs: {
      ...(model.limit?.output && { maxOutputTokens: { max: model.limit.output } }),
      ...(levels.length > 0 && {
        reasoningLevel: { values: levels, map: '{"reasoning":{"effort":reasoningLevel}}' },
      }),
    },
  };
}
