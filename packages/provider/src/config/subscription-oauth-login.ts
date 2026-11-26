import type { SubscriptionOAuthVendor } from "./provider-config.js";

export type { SubscriptionOAuthVendor };

export const GROK_BUILD_SUBSCRIPTION = {
  baseUrl: "https://cli-chat-proxy.grok.com/v1",
  modelId: "grok-4.7",
  fastModelId: "grok-4.7-build-fast",
  headers: {
    "x-xai-token-auth": "xai-grok-cli",
    "x-authenticateresponse": "authenticate-response",
    "x-grok-client-version": "1.0.88",
    "x-grok-client-identifier": "ling",
  },
} as const;

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

export const SUBSCRIPTION_OAUTH_REFRESH_SKEW_MS = 5 * 60 * 1000;

export const PERMANENT_OAUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_grant",
  "invalid_token",
  "unauthorized_client",
  "access_denied",
]);

export class SubscriptionOAuthExchangeError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

export interface StoredSubscriptionToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId?: string;
}

export function readStoredSubscriptionToken(
  vendor: SubscriptionOAuthVendor,
  body: string,
  allowMissingRefresh = false,
): StoredSubscriptionToken {
  const parsed = JSON.parse(body) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    id_token?: unknown;
  };
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
  const refreshToken = typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
  const expiresIn =
    typeof parsed.expires_in === "number" &&
    Number.isFinite(parsed.expires_in) &&
    parsed.expires_in > 0
      ? parsed.expires_in
      : 3600;
  if (!accessToken || (!refreshToken && !allowMissingRefresh)) {
    throw new Error("Sign-in did not return a token.");
  }
  const accountId =
    vendor === "openai-chatgpt"
      ? (readChatGptAccountId(accessToken) ??
        readChatGptAccountId(typeof parsed.id_token === "string" ? parsed.id_token : undefined))
      : undefined;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000 - SUBSCRIPTION_OAUTH_REFRESH_SKEW_MS,
    ...(accountId ? { accountId } : {}),
  };
}

export function buildSubscriptionOAuthHeaders(
  vendor: SubscriptionOAuthVendor,
  contentType: "json" | "form",
): Record<string, string> {
  const profile = subscriptionOAuthProfile(vendor);
  return {
    Accept: "application/json",
    "Content-Type":
      contentType === "json" ? "application/json" : "application/x-www-form-urlencoded",
    ...(profile.userAgent ? { "User-Agent": profile.userAgent } : {}),
  };
}

function endpointHost(target: string): string {
  try {
    return new URL(target).host;
  } catch {
    return "the authorization service";
  }
}

export function describeSubscriptionTransportError(error: unknown, target: string): string {
  const host = endpointHost(target);
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current) && parts.length < 4) {
    seen.add(current);
    const code = "code" in current && typeof current.code === "string" ? current.code : "";
    const message = current.message.replace(/https?:\/\/\S+/g, (url) => endpointHost(url)).trim();
    if (code) parts.push(code);
    if (message && message !== "fetch failed" && message !== code) parts.push(message);
    current = "cause" in current ? current.cause : undefined;
  }
  const detail = parts.filter((part, index) => parts.indexOf(part) === index).join(": ");
  const text = detail.slice(0, 180);
  return text ? `Sign-in could not reach ${host} (${text}).` : `Sign-in could not reach ${host}.`;
}

export function readSubscriptionOAuthErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : "";
  } catch {
    return "";
  }
}

export function readSubscriptionOAuthError(body: string, status: number): string {
  const code = readSubscriptionOAuthErrorCode(body);
  let description = "";
  try {
    const parsed = JSON.parse(body) as { error_description?: unknown };
    if (typeof parsed.error_description === "string") description = parsed.error_description;
  } catch {
    description = "";
  }
  const message = [code, description].filter(Boolean).join(": ");
  return message || `Sign-in failed (HTTP ${status}).`;
}
