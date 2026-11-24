// BIR-01/02：models.dev 到期自动刷新，设置页可强制更新同一地址。
import { NodePersonalProviderConfigRepository } from "@zcode/provider-node";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TID_MODEL_PROVIDER_NAV_ITEM,
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
import { restartIntoWorkspace, seedReplayProvider } from "#e2e/helpers/model-provider-restart";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import {
  startE2ENetworkCaptureProxy,
  type E2ENetworkCaptureArtifact,
  type E2ENetworkCaptureResponseMock,
} from "#e2e/helpers/network-capture-proxy";

const CATALOG_HOST = "models.dev";
const CATALOG_PATH = "/api.json";
const CATALOG_URL = `https://${CATALOG_HOST}${CATALOG_PATH}`;

describe("models.dev 目录自动刷新", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("BIR-01/02：到期自动更新同一地址，手动刷新立即重新下载", async function () {
    this.timeout(360_000);
    const providerId = "e2e-builtin-cadence";
    const modelId = "gpt-e2e-builtin-cadence";
    const paths = getE2EAppDataPaths();
    const repository = new NodePersonalProviderConfigRepository({
      filePath: paths.configFile,
      pollingIntervalMs: false,
    });
    let proxy: Awaited<ReturnType<typeof startE2ENetworkCaptureProxy>> | undefined;
    try {
      await prepareV4ConversationE2E({ skipProvider: true });
      const root = join(paths.workspace, ".zcode-e2e", "builtin-cadence");
      await mkdir(root, { recursive: true });
      const artifacts = join(
        process.env.ZCODE_E2E_ARTIFACT_DIR || join(process.cwd(), ".e2e-artifacts"),
        "provider-builtin-refresh-cadence",
      );
      await mkdir(artifacts, { recursive: true });
      const networkArtifact = join(artifacts, "network.json");
      let context = 500_000;
      const catalog: E2ENetworkCaptureResponseMock = {
        host: CATALOG_HOST,
        path: CATALOG_PATH,
        body: () =>
          JSON.stringify({
            openai: {
              models: {
                [modelId]: {
                  id: modelId,
                  tool_call: true,
                  modalities: { input: ["text"], output: ["text"] },
                  limit: { context },
                },
              },
            },
          }),
      };
      proxy = await startE2ENetworkCaptureProxy({
        artifactPath: networkArtifact,
        caDir: join(root, "ca"),
        responseMocks: [catalog],
      });
      const network = proxy;
      const providerRoot = join(paths.appDataDir, "runtime", "provider");
      const findControlFiles = async () =>
        (await readdir(providerRoot, { recursive: true })).filter(
          (file) => file.includes("models-dev-v1-") && file.endsWith("zcode-builtin-refresh.json"),
        );
      await restartIntoWorkspace({
        afterElectronProcessExit: async () => {
          // 首个隔离窗口在代理装配前可能已开始失败退避。
          await Promise.all(
            (await findControlFiles()).map((file) => rm(join(providerRoot, file), { force: true })),
          );
          await seedReplayProvider({
            id: providerId,
            name: "E2E Builtin Cadence",
            apiKey: "e2e-only",
            baseURL: "http://127.0.0.1:9/v1",
            models: [modelId],
            templateId: "openai",
          });
          // 测试模型必须继承 Built-in，不留下 Personal 规则掩盖更新。
          await repository.update((current) => ({
            ...current,
            models: current.models.deleteExactForProvider(providerId),
          }));
          await seedSettings({
            httpProxy: network.proxyUrl,
            httpProxyNoProxy: "localhost,127.0.0.1,::1",
            httpProxyCaCertPath: network.caCertPath,
          });
        },
      });
      await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
      await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"));
      await clickTestIdByDom(testId(TID_MODEL_PROVIDER_NAV_ITEM, `custom:${providerId}`));
      const row = () => $(`[data-model-provider-model-id="${modelId}"]`);
      await browser.waitUntil(async () => (await row().getText()).includes("500K"), {
        timeout: 60_000,
        timeoutMsg: "启动后的首轮 Built-in 下载没有进入设置 Registry",
      });

      const requests = async () => {
        const artifact = JSON.parse(
          await readFile(networkArtifact, "utf8"),
        ) as E2ENetworkCaptureArtifact;
        return artifact.records.filter(
          (record) => record.host === CATALOG_HOST && record.path === CATALOG_PATH,
        );
      };
      const files = await findControlFiles();
      expect(files).toHaveLength(1);
      const controlPath = join(providerRoot, files[0]!);
      const first = JSON.parse(await readFile(controlPath, "utf8"));
      expect(first.releaseUrl).toBe(CATALOG_URL);
      expect(first.nextEligibleAt - first.releaseDownloadedAt).toBe(3_600_000);
      const downloadsBeforeExpiry = (await requests()).length;
      // 在隔离目录将成功排期推进到期，实际等待下一轮 Host 定时检查。
      context = 700_000;
      await writeFile(controlPath, JSON.stringify({ ...first, nextEligibleAt: 0 }));
      await browser.waitUntil(async () => (await row().getText()).includes("700K"), {
        timeout: 90_000,
        timeoutMsg: "到期检查未自动更新 models.dev 目录",
      });
      expect((await requests()).length).toBeGreaterThan(downloadsBeforeExpiry);

      const downloadsBeforeForce = (await requests()).length;
      context = 800_000;
      const refresh = $('button[aria-label="刷新"],button[aria-label="Refresh"]');
      await refresh.waitForClickable({ timeout: 15_000 });
      await refresh.click();
      await browser.waitUntil(async () => (await row().getText()).includes("800K"), {
        timeout: 30_000,
        timeoutMsg: "设置页刷新未更新同一 URL 的 models.dev 目录",
      });
      expect((await requests()).length).toBeGreaterThan(downloadsBeforeForce);
    } finally {
      repository.dispose();
      await proxy?.stop();
    }
  });
});
