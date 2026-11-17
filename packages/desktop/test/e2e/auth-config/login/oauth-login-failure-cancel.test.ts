import {
  TID_LOGIN_MENU_ITEM,
  TID_LOGIN_TRIGGER,
  TID_LOGIN_USE_API_KEY_BUTTON,
  TID_OAUTH_LOGIN_BUTTON,
} from "@zcode/shared/test-ids";
import { clearAppData, waitForTestIdByDom } from "#e2e/helpers/desktop-app";
import { dismissOccupationOnboarding } from "#e2e/helpers/occupation-onboarding";

describe("欢迎登录页已移除", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("AUTH-05: 启动进入工作区，不再展示登录协议页和 OAuth 渠道", async function () {
    this.timeout(60_000);
    await browser.waitUntil(
      async () => !(await $('[data-testid="root-startup-loading"]').isExisting()),
      { timeout: 30000 },
    );
    await dismissOccupationOnboarding();
    await waitForTestIdByDom(TID_LOGIN_TRIGGER, {
      timeout: 30_000,
      timeoutMsg: "登录页移除后没有进入工作区",
    });
    expect(await $(`[data-testid="${TID_OAUTH_LOGIN_BUTTON}"]`).isExisting()).toBe(false);
    expect(await $(`[data-testid="${TID_LOGIN_USE_API_KEY_BUTTON}"]`).isExisting()).toBe(false);
    expect(await $(`[data-testid="${TID_LOGIN_MENU_ITEM}"]`).isExisting()).toBe(false);
    const text = await browser.execute(() => document.body.innerText);
    expect(text).not.toContain("登录即表示同意");
  });
});
