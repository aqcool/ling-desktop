import { readFile, writeFile } from "node:fs/promises";
import { readE2ECredentialValue } from "#e2e/helpers/desktop-app";
import { BIGMODEL_PROVIDER_ID, ZAI_PROVIDER_ID } from "@zcode/shared";
import {
  TID_LOGIN_REGION_SWITCH,
  TID_LOGIN_TRIGGER,
  TID_OAUTH_ERROR,
  TID_OAUTH_LOGIN_BUTTON,
} from "@zcode/shared/test-ids";
import { clearAppData, getE2EAppDataPaths, waitForTestIdByDom } from "#e2e/helpers/desktop-app";

const OAUTH_CREDENTIAL_KEYS = [
  "oauth:active_provider",
  `oauth:${ZAI_PROVIDER_ID}:access_token`,
  `oauth:${ZAI_PROVIDER_ID}:refresh_token`,
  `oauth:${ZAI_PROVIDER_ID}:user_info`,
  `oauth:${BIGMODEL_PROVIDER_ID}:access_token`,
  `oauth:${BIGMODEL_PROVIDER_ID}:refresh_token`,
  `oauth:${BIGMODEL_PROVIDER_ID}:user_info`,
  "zcodejwttoken",
] as const;

describe("OAuth 凭据损坏恢复", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("冷启动遇到无法解密的 OAuth 凭据时进入工作区并清理损坏登录态", async () => {
    await waitForTestIdByDom(TID_LOGIN_TRIGGER, {
      timeout: 60000,
      timeoutMsg: "损坏 OAuth 凭据恢复后没有进入工作区",
    });
    expect(await $(`[data-testid="${TID_OAUTH_LOGIN_BUTTON}"]`).isExisting()).toBe(false);
    expect(await $(`[data-testid="${TID_LOGIN_REGION_SWITCH}"]`).isExisting()).toBe(false);
    await expectNoOAuthErrorAlert();
    await waitForCorruptOAuthCredentialsCleanup();
    expect(await readE2ECredentialValue("bot:e2e:credential")).toBe("e2e-independent-bot-token");
  });

  for (const [label, contents] of [
    ["非法 JSON", '{"oauth:active_provider":'],
    ["值类型不符", '{"oauth:active_provider":42}'],
  ] as const) {
    it(`凭据库${label}时不打开登录页且不改写原文件`, async () => {
      const { credentialsFile } = getE2EAppDataPaths();
      const original = await readFile(credentialsFile, "utf-8");
      try {
        await waitForTestIdByDom(TID_LOGIN_TRIGGER);
        await writeFile(credentialsFile, contents, "utf-8");
        await browser.reloadSession();
        await browser.waitUntil(
          async () => {
            const loginPage = await $(`[data-testid="${TID_OAUTH_LOGIN_BUTTON}"]`).isExisting();
            const workspace = await $(`[data-testid="${TID_LOGIN_TRIGGER}"]`).isExisting();
            const recovery = await $('[data-testid="credential-store-recovery"]').isExisting();
            return !loginPage && (workspace || recovery);
          },
          { timeout: 30000, timeoutMsg: "凭据库读取失败后打开了已移除的登录页" },
        );
        expect(await readFile(credentialsFile, "utf-8")).toBe(contents);
      } finally {
        await writeFile(credentialsFile, original, "utf-8");
      }
    });
  }
});

async function expectNoOAuthErrorAlert() {
  const errorText = (await browser.execute((testId) => {
    return (
      document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.textContent?.trim() ?? null
    );
  }, TID_OAUTH_ERROR)) as string | null;

  expect(errorText).toBeNull();
}

async function waitForCorruptOAuthCredentialsCleanup() {
  try {
    await browser.waitUntil(
      async () => {
        const credentials = await readCredentials();
        return OAUTH_CREDENTIAL_KEYS.every((key) => !(key in credentials));
      },
      {
        timeout: 10000,
        timeoutMsg: "损坏 OAuth 凭据没有被清理",
      },
    );
  } catch (error) {
    const credentials = await readCredentials().catch(() => null);
    const keys = credentials ? Object.keys(credentials).sort().join(", ") : "<missing>";
    throw new Error(`损坏 OAuth 凭据没有被清理，当前凭据 key: ${keys}`, {
      cause: error,
    });
  }
}

async function readCredentials(): Promise<Record<string, string>> {
  const { credentialsFile } = getE2EAppDataPaths();
  return JSON.parse(await readFile(credentialsFile, "utf-8")) as Record<string, string>;
}
