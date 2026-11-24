import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_MODEL_PROVIDER_IDS as ids } from "@zcode/shared";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  seedSettings,
} from "#e2e/helpers/desktop-app";
import {
  readBigModelConnectionSelection,
  restartIntoWorkspace,
  seedBigModelConnectionSelection,
  seedBigModelStartPlanCredential,
} from "#e2e/helpers/model-provider-restart";
import { getV4ModelConfig, prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import { startE2ENetworkCaptureProxy } from "#e2e/helpers/network-capture-proxy";

import {
  selectRegistryProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "#e2e/helpers/upstream-provider";

describe("Builtin 下载失败时的套餐操作", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("BR117-F01：models.dev 下载失败后有效本地配置保留 Team 连接和 Start 模型选择", async function () {
    this.timeout(180_000);
    const upstream = process.env.ZCODE_E2E_CODING_PLAN_MOCK_URL;
    if (!upstream) throw new Error("Missing isolated account control plane");
    const team = {
      kind: "team-coding-plan" as const,
      productId: "product-team-a",
      organizationId: "org-team-a",
      projectId: "proj-team-a",
    };
    const paths = getE2EAppDataPaths();
    const artifacts = join(
      process.env.ZCODE_E2E_ARTIFACT_DIR || join(process.cwd(), ".e2e-artifacts"),
      "builtin-refresh-failure",
    );
    await mkdir(artifacts, { recursive: true });
    const network = await startE2ENetworkCaptureProxy({
      artifactPath: join(artifacts, "network.json"),
      caDir: join(artifacts, "ca"),
      responseMocks: [{ host: "models.dev", path: "/api.json", statusCode: 500, body: "" }],
    });
    try {
      await prepareV4ConversationE2E({ skipProvider: true });
      const scenario = await fetch(`${upstream}/__e2e/coding-plan/scenario`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: "both", providerResponsive: true }),
      });
      expect(scenario.ok).toBe(true);
      await restartIntoWorkspace({
        afterElectronProcessExit: async () => {
          const providerRoot = join(paths.appDataDir, "runtime", "provider");
          const controls = (await readdir(providerRoot, { recursive: true })).filter(
            (file) =>
              file.includes("models-dev-v1-") && file.endsWith("zcode-builtin-refresh.json"),
          );
          // 首个隔离窗口可能正持有直连刷新 lease；新窗口需要立即向测试代理请求。
          await Promise.all(controls.map((file) => rm(join(providerRoot, file), { force: true })));
          await seedBigModelStartPlanCredential();
          await seedBigModelConnectionSelection(team);
          await seedSettings({
            zcodeEndpointOrigin: upstream,
            httpProxy: network.proxyUrl,
            httpProxyNoProxy: "localhost,127.0.0.1,::1",
            httpProxyCaCertPath: network.caCertPath,
          });
        },
      });
      await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
      await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"));
      const logsBeforeRefresh = (await readRuntimeLogs(paths.appDataDir)).length;
      const refresh = $('button[aria-label="刷新"],button[aria-label="Refresh"]');
      await refresh.waitForClickable({ timeout: 15_000 });
      await refresh.click();
      // 等待真实刷新 RPC 成功，避免只看保存中间态，遗漏后续回滚。
      await browser.waitUntil(
        async () => {
          const logs = (await readRuntimeLogs(paths.appDataDir)).slice(logsBeforeRefresh);
          return (
            logs.includes("Builtin 远端更新失败，继续使用本地配置") &&
            logs.includes("provider-settings.refresh OK")
          );
        },
        { timeout: 20_000, timeoutMsg: "远端更新失败仍导致业务刷新 RPC 失败" },
      );
      await browser.waitUntil(
        async () => {
          const artifact = JSON.parse(await readFile(network.artifactPath, "utf8")) as {
            records: Array<{ host: string; path: string; statusCode?: number }>;
          };
          return artifact.records.some(
            (record) =>
              record.host === "models.dev" &&
              record.path === "/api.json" &&
              record.statusCode === 500,
          );
        },
        { timeout: 15_000, timeoutMsg: "代理未记录 models.dev 返回 HTTP 500" },
      );
      expect(await readBigModelConnectionSelection()).toEqual(team);
      await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
      // 团队菜单行按完整连接身份区分，不能查找已移除的 registry-provider:team 行。
      await selectRegistryProviderModelById("GLM-5.3", {
        providerId: ids.bigmodelTeamCodingPlan,
        providerGroupKey: JSON.stringify([
          "bigmodel",
          "team-coding-plan",
          "product-team-a",
          "org-team-a",
          "proj-team-a",
        ]),
        includePlainModelFallback: false,
      });
      await selectUpstreamThoughtLevelValue("high");
      expect(await getV4ModelConfig()).toMatchObject({
        provider: ids.bigmodelTeamCodingPlan,
        model: "GLM-5.3",
      });
      // GLM-5-Turbo 已退役；Start Plan 使用共享 balance 返回的当前模型 GLM-5.3。
      await selectRegistryProviderModelById("GLM-5.3", {
        providerId: ids.bigmodelStartPlan,
        includePlainModelFallback: false,
      });
      await selectUpstreamThoughtLevelValue("high");
      expect(await getV4ModelConfig()).toMatchObject({
        provider: ids.bigmodelStartPlan,
        model: "GLM-5.3",
      });
      expect(await readBigModelConnectionSelection()).toEqual(team);
      await browser.saveScreenshot(join(artifacts, "start-model-after-team-switch.png"));
      await writeFile(
        join(artifacts, "assertions.json"),
        JSON.stringify({ team, selection: await getV4ModelConfig() }, null, 2),
      );
    } finally {
      await network.stop();
    }
  });
});

async function readRuntimeLogs(configDir: string): Promise<string> {
  const dir = process.env.ZCODE_E2E_RUNTIME_LOG_DIR?.trim() || join(configDir, "logs");
  const files = await readdir(dir).catch(() => []);
  return (
    await Promise.all(
      files
        .filter((name) => name.endsWith(".log"))
        .map((name) => readFile(join(dir, name), "utf8")),
    )
  ).join("\n");
}
