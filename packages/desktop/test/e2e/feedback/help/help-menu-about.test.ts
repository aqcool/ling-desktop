import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlatformChannels, type UpdateStatePayload } from "@zcode/shared";
import {
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_PAGE,
  TID_WORKSPACE_HELP_MENU_TRIGGER,
} from "@zcode/shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clickTestIdByWebDriver,
  pinE2ELocale,
  waitForWorkspaceApp,
  seedSettings,
  readSettings,
} from "#e2e/helpers/desktop-app";
import { startHelpConfigFixture } from "#e2e/helpers/help-client-config-fixture";

// Node 侧 shared 常量没有 renderer 的编译 define，不能据此跳过 production 分支。
// 默认正式套件构建 Preview；production 用显式参数独立验证，不能静默跳过。
const expectedFlavor = process.env.ZCODE_E2E_HELP_MENU_FLAVOR ?? "preview";
if (expectedFlavor !== "production" && expectedFlavor !== "preview") {
  throw new Error("请设置 ZCODE_E2E_HELP_MENU_FLAVOR=production 或 preview，并构建对应产品身份");
}

async function enterWorkspace() {
  // 隔离 HOME 首次启动与刷新都可能显示引导，使用产品支持的 Escape 退出。
  await browser.waitUntil(
    async () => {
      if (await $('[data-testid="onboarding-page"]').isDisplayed()) await browser.keys("Escape");
      return $(`[data-testid="${TID_TASK_SETTINGS_BUTTON}"]`).isExisting();
    },
    { timeout: 30_000, timeoutMsg: "首次使用引导关闭后未进入工作区" },
  );
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
}

async function publishState(state: UpdateStatePayload) {
  await browser.electron.execute(
    (electron, channel, payload) => {
      for (const window of electron.BrowserWindow.getAllWindows()) {
        if (window.webContents.getURL().includes("/renderer/index.html")) {
          window.webContents.send(channel, payload);
        }
      }
    },
    PlatformChannels.UpdateStateChanged,
    state,
  );
}
async function menuLabels() {
  return $$('[role="menuitem"]').map((item) => item.getText());
}
async function openMenu() {
  await browser.waitUntil(
    async () => {
      for (const trigger of await $$(`[data-testid="${TID_WORKSPACE_HELP_MENU_TRIGGER}"]`)) {
        if (await trigger.isDisplayed()) return true;
      }
      return false;
    },
    { timeout: 10_000, timeoutMsg: "侧栏更多菜单尚未挂载到可见页面" },
  );
  const triggers = await $$(`[data-testid="${TID_WORKSPACE_HELP_MENU_TRIGGER}"]`);
  for (const trigger of triggers) {
    if (await trigger.isDisplayed()) {
      await trigger.waitForClickable();
      await trigger.click();
      break;
    }
  }
  await $('[role="menu"]').waitForDisplayed();
}
function expectDesktopUtilityItems(labels: string[], removed: string[], required: string[]) {
  for (const label of removed) expect(labels).not.toContain(label);
  for (const label of required) expect(labels).toContain(label);
}
async function closeMenu() {
  await browser.keys("Escape");
  await $('[role="menu"]').waitForDisplayed({ reverse: true });
}
async function setTheme(theme: "zai-light" | "zai-dark") {
  await browser.execute((value) => {
    const actions = (
      window as typeof window & { __testActions?: { setTheme?: (theme: string) => void } }
    ).__testActions;
    if (!actions?.setTheme) throw new Error("缺少主题测试入口");
    actions.setTheme(value);
  }, theme);
}
async function assertLogExport(label: string, pendingLabel: string) {
  // 只拦截系统文件浏览器，保留菜单、preload、IPC 和主进程真实打包链路。
  const reveal = await browser.electron.mock("shell", "showItemInFolder");
  await reveal.mockReturnValue(undefined);
  try {
    await $(`[role="menuitem"]*=${label}`).click();
    await $('[role="menu"]').waitForDisplayed({ reverse: true });
    await browser.waitUntil(
      async () => {
        await reveal.update();
        return reveal.mock.calls.length === 1;
      },
      { timeout: 30_000, timeoutMsg: "点击导出日志后未生成归档并请求系统定位" },
    );
    const archivePath = String(reveal.mock.calls[0]?.[0]);
    expect(archivePath).toMatch(/zcode-logs-[^/\\]+\.zip$/);
    const archive = await readFile(archivePath);
    expect(archive.subarray(0, 4).toString("hex")).toBe("504b0304");
    await browser.waitUntil(
      async () => !(await $("#zcode-toast-host").getText()).includes(pendingLabel),
      { timeout: 10_000, timeoutMsg: "日志导出完成后提示未关闭" },
    );
  } finally {
    await reveal.mockRestore();
  }
}
async function assertAboutWindow() {
  try {
    await browser.waitUntil(
      async () =>
        browser.electron.execute(async (electron) => {
          const window = electron.BrowserWindow.getAllWindows().find(
            (candidate) =>
              candidate.webContents.getURL().startsWith("data:text/html") &&
              decodeURIComponent(candidate.webContents.getURL()).includes('id="about-title"'),
          );
          if (!window?.isVisible()) return false;
          const title = await window.webContents.executeJavaScript(
            'document.querySelector("#about-title")?.textContent',
          );
          return (
            typeof title === "string" &&
            title.includes("LING") &&
            title.includes(electron.app.getVersion())
          );
        }),
      { timeout: 10_000, timeoutMsg: "关于窗口未显示应用名称和版本" },
    );
  } finally {
    await browser.electron.execute((electron) => {
      for (const window of electron.BrowserWindow.getAllWindows()) {
        if (
          window.webContents.getURL().startsWith("data:text/html") &&
          decodeURIComponent(window.webContents.getURL()).includes('id="about-title"')
        )
          window.close();
      }
    });
  }
}

describe(`问号菜单应用入口（${expectedFlavor}）`, () => {
  let originalSettings: Awaited<ReturnType<typeof readSettings>>;
  let helpConfig: Awaited<ReturnType<typeof startHelpConfigFixture>>;
  before(async () => {
    await enterWorkspace();
    originalSettings = await readSettings();
    // 动态漏洞入口由配置决定；固定本地配置，避免远端配置或加载占位影响菜单顺序断言。
    helpConfig = await startHelpConfigFixture({});
    await seedSettings({
      locale: "en-US",
      localePreference: "en-US",
      zcodeEndpointOrigin: helpConfig.origin,
    });
    await browser.refresh();
    await enterWorkspace();
    // 写 setting.json 不会改已加载的 renderer 语言；菜单文案断言必须走真实 setLocale。
    await pinE2ELocale("en-US");
  });
  afterEach(async () => {
    if (await $('[role="menu"]').isDisplayed()) await closeMenu();
    await publishState({ kind: "idle", enabled: true });
  });
  after(async () => {
    try {
      await seedSettings(originalSettings);
    } finally {
      await helpConfig?.close();
    }
  });

  it("HM-01 英文草稿菜单顺序、导出日志和关于窗口", async function () {
    this.timeout(60_000);
    await setTheme("zai-light");
    await openMenu();
    const labels = await menuLabels();
    expectDesktopUtilityItems(
      labels,
      ["Product docs", "User community", "Report an issue", "Request a feature"],
      ["Export logs", "Usage stats", "Resource manager", "Check for updates", "About LING"],
    );
    await browser.saveScreenshot(join(tmpdir(), "zcode-help-export-en-light.png"));
    await assertLogExport("Export logs", "Exporting logs...");
    await openMenu();
    await $('[role="menuitem"]*=About LING').click();
    await assertAboutWindow();
  });

  it("HM-02 更新状态事件、禁用状态与关闭重开", async function () {
    this.timeout(60_000);
    await openMenu();
    for (const [state, label] of [
      [{ kind: "checking", enabled: false }, "Checking for updates..."],
      [{ kind: "update-available", enabled: true, version: "99.0.0" }, "Update available 99.0.0"],
      [{ kind: "download-progress", enabled: true, progress: "42%" }, "Downloading update... 42%"],
      [
        { kind: "installer-download", enabled: false, progress: "52%" },
        "Downloading update... 52%",
      ],
      [{ kind: "update-downloaded", enabled: true, version: "99.0.0" }, "Restart to update"],
    ] as const) {
      await publishState(state);
      const item = $(`[role="menuitem"]*=${label}`);
      await item.waitForDisplayed();
      if (state.kind === "update-downloaded") {
        expect(await item.getText()).toContain(state.version);
      }
      if (!state.enabled) await expect(item).toHaveAttribute("aria-disabled", "true");
      else expect(await item.getAttribute("aria-disabled")).not.toBe("true");
    }
    await closeMenu();
    await openMenu();
    const restartItem = $('[role="menuitem"]*=Restart to update');
    await expect(restartItem).toBeDisplayed();
    expect(await restartItem.getText()).toContain("99.0.0");
    await closeMenu();
    await publishState({ kind: "idle", enabled: true });
  });

  it("HM-03 手动检查下载对应架构的安装包后交给系统", async function () {
    this.timeout(60_000);
    expect(await browser.electron.execute((electron) => electron.app.isPackaged)).toBe(false);
    const downloads = await mkdtemp(join(tmpdir(), "ling-update-e2e-"));
    const target =
      process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
    const extension = target === "mac" ? ".dmg" : target === "win" ? ".exe" : ".deb";
    const name = `LING-99.0.0-${target}-${process.arch}${extension}`;
    const contents = "LING test installer";
    const checksum = createHash("sha256").update(contents).digest("hex");
    const handoff = await browser.electron.mock(
      "shell",
      target === "linux" ? "showItemInFolder" : "openPath",
    );
    try {
      await handoff.mockReturnValue(target === "linux" ? undefined : "");
      await browser.electron.execute(
        (electron, dir, filename, data, digest) => {
          const originalFetch = electron.net.fetch;
          const originalDownloads = electron.app.getPath("downloads");
          const fixture = globalThis as typeof globalThis & {
            restoreLingUpdateFixture?: () => void;
          };
          fixture.restoreLingUpdateFixture = () => {
            electron.net.fetch = originalFetch;
            electron.app.setPath("downloads", originalDownloads);
            delete fixture.restoreLingUpdateFixture;
          };
          electron.app.setPath("downloads", dir);
          let installRequests = 0;
          electron.net.fetch = async (input, init) => {
            const url = typeof input === "string" ? input : input.url;
            if (url.startsWith("https://api.github.com/repos/aqcool/ling-desktop/releases?")) {
              return Response.json([
                {
                  tag_name: "ling-v99.0.0",
                  draft: false,
                  prerelease: true,
                  assets: [{ name: filename, size: data.length }, { name: "SHA256SUMS" }],
                },
              ]);
            }
            const releaseBase =
              "https://github.com/aqcool/ling-desktop/releases/download/ling-v99.0.0/";
            if (url === releaseBase + "SHA256SUMS") return new Response(digest + "  " + filename);
            if (url === releaseBase + filename) {
              return new Response(++installRequests === 1 ? "x".repeat(data.length) : data);
            }
            return originalFetch.call(electron.net, input, init);
          };
        },
        downloads,
        name,
        contents,
        checksum,
      );
      await openMenu();
      await $('[role="menuitem"]*=Check for updates').click();
      await browser.waitUntil(
        async () => (await $("#zcode-toast-host").getText()).includes("Update check failed"),
        { timeout: 10_000, timeoutMsg: "损坏的安装包没有被拒绝" },
      );
      await handoff.update();
      expect(handoff.mock.calls.length).toBe(0);
      await openMenu();
      await $('[role="menuitem"]*=Check for updates').click();
      await browser.waitUntil(
        async () => {
          await handoff.update();
          return handoff.mock.calls.length === 1;
        },
        { timeout: 10_000, timeoutMsg: "校验完成后没有打开安装包" },
      );
      const path = join(downloads, "LING Updates", name);
      expect(handoff.mock.calls[0]?.[0]).toBe(path);
      expect(await readFile(path, "utf8")).toBe(contents);
    } finally {
      await browser.electron.execute(() => {
        const fixture = globalThis as typeof globalThis & {
          restoreLingUpdateFixture?: () => void;
        };
        fixture.restoreLingUpdateFixture?.();
      });
      await handoff.mockRestore();
      await rm(downloads, { recursive: true, force: true });
    }
  });

  it("HM-04 中文设置页的导出日志、关于及更新入口", async function () {
    this.timeout(60_000);
    await seedSettings({ locale: "zh-CN", localePreference: "zh-CN" });
    await browser.refresh();
    await enterWorkspace();
    // 中文菜单文案同样要走真实 setLocale，settings 写入不会改已加载的 renderer。
    await pinE2ELocale("zh-CN");
    await setTheme("zai-dark");
    await clickTestIdByWebDriver(TID_TASK_SETTINGS_BUTTON);
    await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed();
    await openMenu();
    const labels = await menuLabels();
    expectDesktopUtilityItems(
      labels,
      ["产品文档", "用户社群", "问题上报", "给产品提需求"],
      ["导出日志", "使用统计", "资源管理器", "检查更新", "关于 LING"],
    );
    await browser.saveScreenshot(join(tmpdir(), "zcode-help-export-zh-dark.png"));
    await assertLogExport("导出日志", "正在导出日志中");
    await openMenu();
    await $('[role="menuitem"]*=关于 LING').click();
    await assertAboutWindow();
  });
});
