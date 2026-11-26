import {
  validateModelSelectionOptions,
  type ModelSelection,
  type ProviderRegistryView,
} from "./registry.js";

export type InitialModelSelectionResolution =
  | {
      readonly source: "configured-default" | "registry-fallback";
      readonly selection: ModelSelection;
    }
  | { readonly source: "none" };

interface ModelSelectionCompletionView {
  readonly providers: readonly {
    readonly providerId: string;
    readonly models: readonly {
      readonly modelId: string;
      readonly config: {
        readonly optionSpecs: {
          readonly reasoningLevel: { readonly values: readonly string[] };
        };
      };
    }[];
  }[];
}

export const CANONICAL_REASONING_EFFORT_ORDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/**
 * 参考 Pi / OpenCode 的有序强度阶梯夹逼：当模型目录变更或切换模型导致原思考强度不在新列表时，
 * 按强度阶梯映射至最接近的可用档位，而不是直接清空。
 */
export function clampReasoningLevel(
  desired: string | undefined,
  supportedValues: readonly string[],
): string | undefined {
  if (!desired || supportedValues.length === 0) return undefined;
  if (supportedValues.includes(desired)) return desired;
  const desiredRank = CANONICAL_REASONING_EFFORT_ORDER.indexOf(
    desired as (typeof CANONICAL_REASONING_EFFORT_ORDER)[number],
  );
  if (desiredRank < 0) return undefined;
  let bestValue: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestRank = -1;
  for (const candidate of supportedValues) {
    const rank = CANONICAL_REASONING_EFFORT_ORDER.indexOf(
      candidate as (typeof CANONICAL_REASONING_EFFORT_ORDER)[number],
    );
    if (rank < 0) continue;
    const distance = Math.abs(rank - desiredRank);
    if (distance < bestDistance || (distance === bestDistance && rank > bestRank)) {
      bestDistance = distance;
      bestRank = rank;
      bestValue = candidate;
    }
  }
  return bestValue;
}

export function resolveInitialModelSelection(input: {
  readonly configuredDefault?: ModelSelection;
  readonly registry: ProviderRegistryView;
}): InitialModelSelectionResolution {
  // 这里只构造 Host 的初始推荐，不解析已有会话意图。失效默认是可丢弃偏好，
  // 应继续按 Registry 顺序推荐；不能把历史选择留空的规则误用于新草稿初始化。
  if (input.configuredDefault) {
    if (isSelectable(input.registry, input.configuredDefault)) {
      return {
        source: "configured-default",
        selection: freezeSelection(input.configuredDefault),
      };
    }
    // 当默认模型仍可用但思考强度档位随目录调整而变化时，夹逼到最接近的可用档位，避免整条默认配置被丢弃。
    const provider = input.registry.providers.find(
      (candidate) => candidate.providerId === input.configuredDefault?.providerId,
    );
    const model =
      provider?.config.visibility !== "hidden"
        ? provider?.models.find(
            (candidate) => candidate.modelId === input.configuredDefault?.modelId,
          )
        : undefined;
    const clamped = model
      ? clampReasoningLevel(
          input.configuredDefault.options?.reasoningLevel,
          model.config.optionSpecs.reasoningLevel.values,
        )
      : undefined;
    if (clamped) {
      const candidate: ModelSelection = {
        ...input.configuredDefault,
        options: { ...input.configuredDefault.options, reasoningLevel: clamped },
      };
      if (isSelectable(input.registry, candidate)) {
        return {
          source: "configured-default",
          selection: freezeSelection(candidate),
        };
      }
    }
  }

  // 仅用于全新草稿的 Host 初始推荐；历史未绑定状态不能进入这个初始化分支。
  for (const provider of input.registry.providers) {
    if (provider.config.visibility === "hidden") continue;
    for (const model of provider.models) {
      const selection = completeNewModelSelection(input.registry, {
        providerId: provider.providerId,
        modelId: model.modelId,
      });
      if (selection) return { source: "registry-fallback", selection: freezeSelection(selection) };
    }
  }
  return { source: "none" };
}

/** 仅在用户主动选模型或全新初始化时构造最高档；不能用于恢复/重解析已有选择。 */
export function completeNewModelSelection(
  registry: ModelSelectionCompletionView,
  selection: ModelSelection,
): ModelSelection | undefined {
  const model = registry.providers
    .find((provider) => provider.providerId === selection.providerId)
    ?.models.find((candidate) => candidate.modelId === selection.modelId);
  const reasoningLevel = model?.config.optionSpecs.reasoningLevel.values.at(-1);
  if (!reasoningLevel) return undefined;
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    options: { reasoningLevel },
  };
}

/**
 * 规范化一份待提交的 Selection。
 * 已有选择缺失或失效时只保留模型身份，等待用户选择档位；主动选模型另走 completion。
 * 任何执行入口都必须在此之后再次确认 Selection 完整，不能静默补档位。
 */
export function normalizeModelSelection(
  registry: ModelSelectionCompletionView,
  selection: ModelSelection,
): ModelSelection | undefined {
  const model = registry.providers
    .find((provider) => provider.providerId === selection.providerId)
    ?.models.find((candidate) => candidate.modelId === selection.modelId);
  if (!model) return undefined;
  const values = model.config.optionSpecs.reasoningLevel.values;
  const reasoningLevel = selection.options?.reasoningLevel;
  if (reasoningLevel !== undefined && values.includes(reasoningLevel)) return selection;
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
  };
}

function isSelectable(registry: ProviderRegistryView, selection: ModelSelection): boolean {
  const provider = registry.providers.find(
    (candidate) => candidate.providerId === selection.providerId,
  );
  if (provider?.config.visibility === "hidden") return false;
  const model = provider?.models.find((candidate) => candidate.modelId === selection.modelId);
  if (!model) return false;
  return validateModelSelectionOptions(model, selection).ok;
}

function freezeSelection(selection: ModelSelection): ModelSelection {
  return Object.freeze({
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(selection.options ? { options: Object.freeze({ ...selection.options }) } : {}),
  });
}
