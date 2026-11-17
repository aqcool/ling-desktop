import type { SubscriptionOAuthVendor } from "./provider-config.js";

export type { SubscriptionOAuthVendor };

export type SubscriptionOAuthFlow = "browser" | "device";

export interface SubscriptionOAuthProfile {
  readonly vendor: SubscriptionOAuthVendor;
  readonly flow: SubscriptionOAuthFlow;
  readonly clientId: string;
  readonly authorizeUrl?: string;
  readonly tokenUrl: string;
  readonly deviceCodeUrl?: string;
  readonly redirectUri?: string;
  readonly scope: string;
  readonly callbackPort?: number;
  readonly callbackPath?: string;
  /** 设备码请求里的 referrer。与 OpenCode 桌面端使用的公开客户端一致。 */
  readonly deviceReferrer?: string;
  /** xAI 设备码与换票请求的 User-Agent，与 OpenCode 桌面端同一形式。 */
  readonly userAgent?: string;
  readonly originator?: string;
}

/**
 * 公开订阅客户端，没有密钥，授权靠 PKCE 或设备码。
 * Claude、ChatGPT 与 Pi 的回调客户端一致。xAI 设备码的 referrer 与 User-Agent 跟 OpenCode 桌面端一致。
 */
export const SUBSCRIPTION_OAUTH_PROFILES: Readonly<
  Record<SubscriptionOAuthVendor, SubscriptionOAuthProfile>
> = {
  anthropic: {
    vendor: "anthropic",
    flow: "browser",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    authorizeUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://platform.claude.com/v1/oauth/token",
    redirectUri: "http://localhost:53692/callback",
    scope:
      "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    callbackPort: 53692,
    callbackPath: "/callback",
  },
  "openai-chatgpt": {
    vendor: "openai-chatgpt",
    flow: "browser",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    redirectUri: "http://localhost:1455/auth/callback",
    scope: "openid profile email offline_access",
    callbackPort: 1455,
    callbackPath: "/auth/callback",
    originator: "codex_cli_rs",
  },
  xai: {
    vendor: "xai",
    flow: "device",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    deviceCodeUrl: "https://auth.x.ai/oauth2/device/code",
    scope: "openid profile email offline_access grok-cli:access api:access",
    deviceReferrer: "opencode",
    userAgent: "opencode/desktop",
  },
};

export function subscriptionOAuthProfile(
  vendor: SubscriptionOAuthVendor,
): SubscriptionOAuthProfile {
  return SUBSCRIPTION_OAUTH_PROFILES[vendor];
}

export function buildSubscriptionAuthorizeUrl(input: {
  readonly vendor: Exclude<SubscriptionOAuthVendor, "xai">;
  readonly challenge: string;
  readonly state: string;
}): string {
  const profile = subscriptionOAuthProfile(input.vendor);
  const url = new URL(profile.authorizeUrl ?? "");
  if (input.vendor === "anthropic") {
    url.searchParams.set("code", "true");
    url.searchParams.set("client_id", profile.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", profile.redirectUri ?? "");
    url.searchParams.set("scope", profile.scope);
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", input.state);
    return url.toString();
  }
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", profile.clientId);
  url.searchParams.set("redirect_uri", profile.redirectUri ?? "");
  url.searchParams.set("scope", profile.scope);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", profile.originator ?? "codex_cli_rs");
  return url.toString();
}

/** 浏览器回调、`code#state` 或裸授权码。 */
export function parseSubscriptionAuthorizationInput(input: string): {
  readonly code?: string;
  readonly state?: string;
} {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // 粘贴内容不一定是完整 URL。
  }
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }
  return { code: value };
}

const CHATGPT_ACCOUNT_CLAIM = "https://api.openai.com/auth";

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function readChatGptAccountId(token: string | undefined): string | undefined {
  const part = token?.split(".")[1];
  if (!part) return undefined;
  try {
    const json = JSON.parse(decodeBase64Url(part)) as {
      [CHATGPT_ACCOUNT_CLAIM]?: { chatgpt_account_id?: unknown };
    };
    const accountId = json[CHATGPT_ACCOUNT_CLAIM]?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}
