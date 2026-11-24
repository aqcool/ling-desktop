import { zcodeProviderRefreshRegistryParamsSchema } from "@zcode/shared";
import type { CreateAiSdkModelOptions } from "@zcode/adapters/model";
import type { Model } from "@zcode/contracts";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiKeyAccessConfig,
  ModelConfigRules,
  ProviderConfig,
  ProviderConfigMap,
  ProviderConfigResolver,
  ProviderRegistry,
  ZhipuAccountAccessConfig,
  type ProviderId,
} from "@zcode/provider";
import {
  NodeZCodeBuiltinProviderConfigSource,
  decodeZCodeBuiltinRelease,
  type ZCodeBuiltinProviderConfigSnapshot,
} from "@zcode/provider-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiProviderModelRuntime } from "../src/app/provider-registry-model-runtime.js";

const zcodeBuiltinProviderConfigFilePath = fileURLToPath(
  new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
);
const source = new NodeZCodeBuiltinProviderConfigSource({
  bundledFilePath: zcodeBuiltinProviderConfigFilePath,
  watch: false,
});
let zcodeBuiltin: ZCodeBuiltinProviderConfigSnapshot;

beforeAll(async () => {
  zcodeBuiltin = await source.read();
});

afterAll(() => source.dispose());

describe("CLI 与 Host 共用的订阅配置交付", () => {
  it("修复已缓存的上游目录，并在刷新、重启和 Managed Worker 中保留订阅模板", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ling-subscription-release-"));
    const activeFilePath = join(directory, "active.json");
    const bundled = JSON.parse(await readFile(zcodeBuiltinProviderConfigFilePath, "utf8"));
    const subscriptions = ["claude-subscription", "chatgpt-subscription", "grok-subscription"];
    const remote = structuredClone(bundled);
    remote.revision = bundled.revision + 2;
    remote.config.providerConfigRules.templateRules =
      remote.config.providerConfigRules.templateRules.filter(
        (template: { templateId: string }) => !subscriptions.includes(template.templateId),
      );
    const codexRule = bundled.config.modelConfigRules.providerSiteRules.find(
      (rule: { modelMatch: string }) => rule.modelMatch === "gpt-6\\.2-(?:astra|sol)",
    );
    expect(codexRule).toBeDefined();
    remote.config.modelConfigRules.providerSiteRules =
      remote.config.modelConfigRules.providerSiteRules.filter(
        (rule: { modelMatch: string }) => rule.modelMatch !== codexRule.modelMatch,
      );
    remote.config.providerConfigRules.templateRules[0].templateNameMap["en-US"] =
      "Updated upstream provider";
    await writeFile(activeFilePath, JSON.stringify(remote));
    const createHost = () =>
      new NodeZCodeBuiltinProviderConfigSource({
        bundledFilePath: zcodeBuiltinProviderConfigFilePath,
        activeFilePath,
        watch: false,
      });
    const host = createHost();
    let worker: NodeZCodeBuiltinProviderConfigSource | undefined;
    let restarted: NodeZCodeBuiltinProviderConfigSource | undefined;
    const expectCodexReasoning = (snapshot: ZCodeBuiltinProviderConfigSnapshot) => {
      for (const modelId of ["gpt-6.2-astra", "gpt-6.2-sol"]) {
        const selection = {
          providerId: "chatgpt-subscription",
          modelId,
          apiType: "openai-responses",
        };
        const reasoning = snapshot.models?.resolve({
          ...selection,
          templateId: "chatgpt-subscription",
          baseUrl: "https://chatgpt.com/backend-api/codex",
        }).optionSpecs?.reasoningLevel;
        expect(reasoning?.values).toEqual(["low", "medium", "high", "xhigh", "max"]);
        expect(reasoning?.map).toBe(codexRule.config.optionSpecs.reasoningLevel.map);
        expect(
          snapshot.models?.resolve({
            ...selection,
            templateId: "openai",
            baseUrl: "https://api.openai.com/v1",
          }).optionSpecs?.reasoningLevel?.values,
        ).toEqual(["disabled", "enabled"]);
      }
    };
    try {
      const snapshot = await host.read();
      expectCodexReasoning(snapshot);
      for (const templateId of subscriptions) {
        expect(snapshot.providerTemplates.get(templateId)?.config.access?.type).toBe(
          "subscription-oauth",
        );
      }
      expect(snapshot.providerTemplates.toJSON()[0]?.templateNameMap["en-US"]).toBe(
        "Updated upstream provider",
      );
      const chatgpt = snapshot.providerTemplates.get("chatgpt-subscription")!.config;
      expect(chatgpt.api?.baseUrl).toBe("https://chatgpt.com/backend-api/codex");
      expect(chatgpt.builtinModelIds).toEqual(
        expect.arrayContaining(["gpt-6.2-astra", "gpt-6.2-sol"]),
      );

      // 真正发请求的 CLI 从 Host 物化的 Active 读取，不能只修复设置页投影。
      worker = new NodeZCodeBuiltinProviderConfigSource({
        bundledFilePath: activeFilePath,
        watch: false,
      });
      expect((await worker.read()).providerTemplates.toJSON()).toEqual(
        snapshot.providerTemplates.toJSON(),
      );
      expect((await worker.read()).revision).toBe(snapshot.revision);
      expectCodexReasoning(await worker.read());
      expect(await host.applyRemoteRelease(decodeZCodeBuiltinRelease(remote))).toBe("unchanged");

      remote.revision += 1;
      remote.config.providerConfigRules.templateRules[0].templateNameMap["en-US"] =
        "Next upstream provider";
      // 即使上游出现同 ID 模板，授权厂商、地址和模型清单仍由随包配置维护。
      const conflicting = structuredClone(
        bundled.config.providerConfigRules.templateRules.find(
          (template: { templateId: string }) => template.templateId === "chatgpt-subscription",
        ),
      );
      conflicting.config.api.baseUrl = "https://example.invalid/overridden";
      remote.config.providerConfigRules.templateRules.push(conflicting);
      remote.config.modelConfigRules.providerSiteRules.push({
        ...codexRule,
        config: { optionSpecs: { reasoningLevel: { values: ["disabled", "enabled"] } } },
      });
      expect(await host.applyRemoteRelease(decodeZCodeBuiltinRelease(remote))).toBe("updated");
      const updated = await host.read();
      expectCodexReasoning(updated);
      expectCodexReasoning(await worker.read());
      expect(updated.providerTemplates.get("chatgpt-subscription")?.config.api?.baseUrl).toBe(
        chatgpt.api?.baseUrl,
      );
      expect(updated.providerTemplates.toJSON()[0]?.templateNameMap["en-US"]).toBe(
        "Next upstream provider",
      );
      expect(await host.applyRemoteRelease(decodeZCodeBuiltinRelease(remote))).toBe("unchanged");

      const beforeRestart = await readFile(activeFilePath, "utf8");
      restarted = createHost();
      expect((await restarted.read()).providerTemplates.toJSON()).toEqual(
        updated.providerTemplates.toJSON(),
      );
      expectCodexReasoning(await restarted.read());
      expect(await readFile(activeFilePath, "utf8")).toBe(beforeRestart);
      const stale = { ...remote, revision: remote.revision - 1 };
      expect(await host.applyRemoteRelease(decodeZCodeBuiltinRelease(stale))).toBe("stale");
      const conflict = structuredClone(remote);
      conflict.config.providerConfigRules.templateRules[0].templateNameMap["en-US"] = "Conflict";
      await expect(host.applyRemoteRelease(decodeZCodeBuiltinRelease(conflict))).rejects.toThrow(
        "对应不同内容",
      );
    } finally {
      restarted?.dispose();
      worker?.dispose();
      host.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("Codex 账号档位跨 Worker 协议同步并替换随包档位", () => {
  const providerId = "chatgpt-fixture";
  const owned = {
    "gpt-6.2-astra": ["low", "high"],
    "gpt-6.2-sol": ["medium", "xhigh", "ultra"],
  };
  const envelope = zcodeProviderRefreshRegistryParamsSchema.parse({
    reason: "test catalog",
    subscriptionAuthorizedProviderIds: [providerId],
    subscriptionReasoningLevels: { [providerId]: owned },
  });
  const registry = new ProviderConfigResolver().resolve({
    zcodeBuiltinProviders: zcodeBuiltin.providers,
    zcodeBuiltinProviderTemplates: zcodeBuiltin.providerTemplates,
    zcodeBuiltinModelRules: zcodeBuiltin.models!,
    personalProviders: new ProviderConfigMap([
      {
        providerId,
        templateId: "chatgpt-subscription",
        config: new ProviderConfig({ group: "standard-personal" }),
      },
    ]),
    accountProviders: ProviderConfigMap.empty(),
    personalModels: ModelConfigRules.empty(),
    subscriptionAuthorizedProviderIds: new Set(envelope.subscriptionAuthorizedProviderIds),
    subscriptionReasoningLevels: envelope.subscriptionReasoningLevels,
  });
  const models = registry.registryProviders.find(
    (provider) => provider.providerId === providerId,
  )?.models;
  for (const [id, values] of Object.entries(owned)) {
    const reasoning = models?.find((model) => model.modelId === id)?.config.optionSpecs
      .reasoningLevel;
    expect(reasoning?.values).toEqual(values);
    expect(reasoning?.map).toBe('{"reasoning":{"effort":reasoningLevel}}');
  }
});

describe("真实 ZCode Built-in Config 到 Active Model", () => {
  it("API Key Personal Overlay 经 Registry 原样装配到 Adapter", () => {
    const providerId = "zai-api";
    const modelId = "glm-5.3";
    const registry = resolveOneBuiltinProvider(providerId, {
      personalProviders: new ProviderConfigMap([
        [
          providerId,
          // 实例在创建时复制模板；Resolver 不会从已退场的 templateId 字段隐式继承。
          zcodeBuiltin.providerTemplates
            .get("zai-api")!
            .config.withPersonalModelIds([modelId])
            .overlay(
              new ProviderConfig({
                group: "standard-personal",
                access: new ApiKeyAccessConfig({ apiKey: "test-zai-api-key" }),
              }),
            ),
        ],
      ]),
    });
    const capture = captureRuntime(registry);

    const model = capture.runtime.modelFactory({
      selection: selectionWithHighestReasoning(registry, providerId, modelId),
    });
    const registryProvider = registry.getProvider(providerId);
    const registryModel = registry.getModel(providerId, modelId);

    expect(model).toBe(capture.models[0]);
    expect(capture.created[0]?.providerConfig).toBe(registryProvider?.config);
    expect(capture.created[0]?.modelConfig).toBe(registryModel?.config);
    expect(capture.created[0]).toMatchObject({
      providerId,
      modelId,
      providerConfig: {
        access: { type: "api-key", apiKey: "test-zai-api-key" },
        api: {
          type: zcodeBuiltin.providerTemplates.get("zai-api")?.config.api?.type,
          baseUrl: zcodeBuiltin.providerTemplates.get("zai-api")?.config.api?.baseUrl,
        },
      },
    });
  });

  it("Account 约束 Built-in 成员后仍由 Personal Overlay 最后覆盖", () => {
    const providerId = "account:zai-start-plan";
    const modelId = "GLM-5.2";
    const registry = resolveOneBuiltinProvider(providerId, {
      accountProviders: new ProviderConfigMap([
        [
          providerId,
          new ProviderConfig({
            builtinModelIds: [modelId],
            access: new ZhipuAccountAccessConfig({ entitled: true }),
          }),
        ],
      ]),
      personalProviders: new ProviderConfigMap([
        [providerId, new ProviderConfig({ visibility: "hidden" })],
      ]),
    });
    const capture = captureRuntime(registry);

    capture.runtime.modelFactory({
      selection: selectionWithHighestReasoning(registry, providerId, modelId),
    });

    expect(registry.getProvider(providerId)?.models.map(({ modelId: id }) => id)).toEqual([
      modelId,
    ]);
    expect(capture.created[0]?.providerConfig).toMatchObject({
      visibility: "hidden",
      access: {
        type: "zhipu-account",
        accountType: "zai",
        mode: "start-plan",
      },
    });
    expect(capture.created[0]?.modelConfig).toBe(registry.getModel(providerId, modelId)?.config);
  });

  it("隐藏 Request Auth Provider 仍由普通 Registry 精确创建 Model", () => {
    const providerId = "account:zai-offpeak-idle-plan";
    const modelId = "GLM-5.3";
    const registry = resolveOneBuiltinProvider(providerId, {
      accountProviders: new ProviderConfigMap([
        [
          providerId,
          new ProviderConfig({
            access: new ZhipuAccountAccessConfig({ entitled: true }),
          }),
        ],
      ]),
    });
    const capture = captureRuntime(registry);
    const requestAuthSource = { resolve: vi.fn() };

    capture.runtime.modelFactory({
      selection: selectionWithHighestReasoning(registry, providerId, modelId),
      requestDependencies: { requestAuth: { source: requestAuthSource } },
    });

    expect(registry.getView().providers[0]).toMatchObject({
      providerId,
      config: {
        visibility: "hidden",
        access: { type: "zhipu-account", accountType: "zai", mode: "off-peak" },
      },
    });
    expect(capture.created[0]?.requestDependencies?.requestAuth?.source).toBe(requestAuthSource);
    expect(capture.created[0]?.providerConfig).toBe(registry.getProvider(providerId)?.config);
    expect(capture.created[0]?.modelConfig).toBe(registry.getModel(providerId, modelId)?.config);
  });
});

function selectionWithHighestReasoning(
  registry: ProviderRegistry,
  providerId: ProviderId,
  modelId: string,
) {
  const reasoningLevel = registry
    .getModel(providerId, modelId)
    ?.config.optionSpecs.reasoningLevel.values.at(-1);
  if (!reasoningLevel) throw new Error(`测试模型缺少 reasoning: ${providerId}/${modelId}`);
  return { providerId, modelId, options: { reasoningLevel } };
}

function resolveOneBuiltinProvider(
  providerId: ProviderId,
  overlays: {
    accountProviders?: ProviderConfigMap;
    personalProviders?: ProviderConfigMap;
    models?: ModelConfigRules;
  } = {},
): ProviderRegistry {
  const provider = zcodeBuiltin.providers.get(providerId);
  const personalProvider = overlays.personalProviders?.get(providerId);
  if (!provider && !personalProvider) {
    throw new Error(`测试引用的 Built-in Provider 或 Personal 实例不存在: ${providerId}`);
  }
  const resolution = new ProviderConfigResolver().resolve({
    zcodeBuiltinProviders: provider
      ? new ProviderConfigMap([[providerId, provider]])
      : ProviderConfigMap.empty(),
    zcodeBuiltinProviderTemplates: zcodeBuiltin.providerTemplates,
    accountProviders: overlays.accountProviders ?? ProviderConfigMap.empty(),
    personalProviders: overlays.personalProviders ?? ProviderConfigMap.empty(),
    zcodeBuiltinModelRules: zcodeBuiltin.models,
    personalModels: overlays.models ?? ModelConfigRules.empty(),
  });
  expect(resolution.issues).toEqual([]);
  return new ProviderRegistry(resolution.registryProviders);
}

function captureRuntime(registry: ProviderRegistry) {
  const created: CreateAiSdkModelOptions[] = [];
  const models: Model[] = [];
  const runtime = new ApiProviderModelRuntime({
    registry: {
      getView: () => registry.getView(),
      getProvider: (providerId) => registry.getProvider(providerId),
      getModel: (providerId, modelId) => registry.getModel(providerId, modelId),
      validateSelection: (selection) => registry.validateSelection(selection),
      onDidChange: (listener) => registry.onDidChange(listener),
    },
    modelAdapter: {
      createModel(options) {
        created.push(options);
        const model = createCapturedModel(options);
        models.push(model);
        return model;
      },
    },
  });
  runtime.start();
  return { created, models, runtime };
}

function createCapturedModel(options: CreateAiSdkModelOptions): Model {
  const model: Model = {
    providerId: options.providerId,
    modelId: options.modelId,
    properties: options.modelConfig.properties,
    optionSpecs: options.modelConfig.optionSpecs,
    options: options.options,
    bind() {
      return model;
    },
    async generateText() {
      throw new Error("not used");
    },
    streamText() {
      throw new Error("not used");
    },
  };
  return model;
}
