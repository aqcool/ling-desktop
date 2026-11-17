import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderConfigMap, createAccountProviderConfigSnapshot } from "@zcode/provider";
import {
  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
  ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV,
} from "@zcode/provider-node";
import { zcodeProtocolMethods } from "@zcode/shared";
import {
  startProcessProviderRegistryRuntime,
  parseProcessAccountProviderConfigSnapshot,
} from "../src/app/process-provider-registry-runtime.js";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function startRuntime(personal?: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "account-delivery-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const personalPath = join(directory, "personal.json");
  if (personal !== undefined) {
    await writeFile(personalPath, JSON.stringify(personal));
  }
  const started = await startProcessProviderRegistryRuntime({
    [ZCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: fileURLToPath(
      new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    [ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: personalPath,
  });
  cleanups.unshift(async () => started.dispose());
  return started;
}

function registryModelIds(
  started: Awaited<ReturnType<typeof startRuntime>>,
  providerId: string,
): readonly string[] {
  return (
    started.runtime.registryService
      .getView()
      .providers.find((provider) => provider.providerId === providerId)
      ?.models.map((model) => model.modelId) ?? []
  );
}

describe("托管 Worker 账号交付", () => {
  it("Account B 先到时接收 B、仍使用 A；配套配置到后才整体应用 B", async () => {
    const started = await startRuntime();
    const registry = started.runtime.registryService;
    const previous = registry.getSnapshot();
    const next = createAccountProviderConfigSnapshot("builtin-B", ProviderConfigMap.empty(), {});
    const server = new ZCodeProtocolAgentServer({
      createZCodeApp() {
        throw new Error("账号交付不得创建会话");
      },
      syncAccountProviderConfig: started.syncAccountProviderConfig,
    });
    expect(
      await server.handleMessage({
        id: 1,
        method: zcodeProtocolMethods.providerUpdateAccountConfig,
        params: {
          ...next,
          providers: Object.fromEntries(
            [...next.providers.entries()].map(([id, config]) => [id, config.toJSON()]),
          ),
        },
      }),
    ).toMatchObject({
      result: { receivedRevision: next.revision, providerCount: 0, status: "received" },
    });
    expect((await started.accountSource.read()).revision).toBe(next.revision);
    expect(registry.getSnapshot()).toBe(previous);

    const config = await started.runtime.configService.read();
    vi.spyOn(started.runtime.configService, "read").mockResolvedValue({
      ...config,
      revision: "config-B",
      zcodeBuiltinRevision: "builtin-B",
    });
    await registry.refresh("配套配置到达");
    expect(registry.getSnapshot()?.account.revision).toBe(next.revision);
    expect(registry.getSnapshot()?.config.zcodeBuiltinRevision).toBe("builtin-B");
  });

  it("刷新失败后同一份快照重交仍刷新，不能因 Source 已收过而跳过", async () => {
    const started = await startRuntime();
    const next = createAccountProviderConfigSnapshot(
      started.snapshot.config.zcodeBuiltinRevision,
      ProviderConfigMap.empty(),
      {},
    );
    const refresh = vi
      .spyOn(started.runtime.registryService, "refresh")
      .mockRejectedValueOnce(new Error("refresh failed"));
    await expect(started.syncAccountProviderConfig(next)).rejects.toThrow("refresh failed");
    await expect(started.syncAccountProviderConfig(next)).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(started.runtime.registryService.getSnapshot()?.account.revision).toBe(next.revision);
  });

  it("普通账号有权益却缺 current 时拒绝交付，不能宽松放行", () => {
    expect(() =>
      parseProcessAccountProviderConfigSnapshot({
        revision: "incomplete",
        basedOnZCodeBuiltinRevision: "builtin-A",
        providers: {
          "account:bigmodel-individual-coding-plan": {
            access: { type: "zhipu-account", entitled: true },
          },
        },
        states: {},
      }),
    ).toThrow("current");
  });

  it.each([
    { providerId: "account:bigmodel-individual-coding-plan", entitled: false },
    { providerId: "account:bigmodel-offpeak-idle-plan", entitled: true },
  ])("初始 fail-closed 和闲时不被强加 current：$providerId", ({ providerId, entitled }) => {
    expect(() =>
      parseProcessAccountProviderConfigSnapshot({
        revision: "allowed",
        basedOnZCodeBuiltinRevision: "builtin-A",
        states: {},
        providers: { [providerId]: { access: { type: "zhipu-account", entitled } } },
      }),
    ).not.toThrow();
  });

  it("订阅登录名单随 refreshRegistry 进入发送准入，缺席不覆盖，空名单退出", async () => {
    const providerId = "chatgpt-sub";
    const started = await startRuntime({
      schemaVersion: 1,
      config: {
        providerConfigRules: {
          providerRules: [
            {
              providerId,
              templateId: "chatgpt-subscription",
              enabled: true,
              config: {
                group: "standard-personal",
                access: { type: "subscription-oauth", vendor: "openai-chatgpt" },
              },
            },
          ],
        },
        modelConfigRules: {
          providerModelRules: [],
          manualProviderModelRules: [],
        },
      },
    });
    const server = new ZCodeProtocolAgentServer({
      createZCodeApp() {
        throw new Error("订阅准入不得创建会话");
      },
      refreshProviderRegistry: async (reason, subscriptionAuthorizedProviderIds) => {
        if (subscriptionAuthorizedProviderIds) {
          started.replaceSubscriptionAuthorizedProviderIds(subscriptionAuthorizedProviderIds);
        }
        await started.runtime.registryService.refresh(reason);
      },
    });
    const refresh = (params: {
      reason: string;
      subscriptionAuthorizedProviderIds?: readonly string[];
    }) =>
      server.handleMessage({
        id: 1,
        method: zcodeProtocolMethods.providerRefreshRegistry,
        params,
      });

    // 设置里已有卡片，但未登录不能进入 Agent 进程的发送目录。
    expect(
      started.runtime.registryService
        .getSnapshot()
        ?.resolution.resolvedProviders.some((provider) => provider.providerId === providerId),
    ).toBe(true);
    expect(registryModelIds(started, providerId)).toEqual([]);

    await expect(
      refresh({ reason: "signed-in", subscriptionAuthorizedProviderIds: [providerId] }),
    ).resolves.toMatchObject({
      result: { refreshed: true },
    });
    expect(registryModelIds(started, providerId)).toContain("gpt-5.6-terra");

    await refresh({ reason: "unrelated" });
    expect(registryModelIds(started, providerId)).toContain("gpt-5.6-terra");

    await refresh({ reason: "signed-out", subscriptionAuthorizedProviderIds: [] });
    expect(registryModelIds(started, providerId)).toEqual([]);
  });
});
