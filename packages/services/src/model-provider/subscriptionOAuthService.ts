import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  buildSubscriptionAuthorizeUrl,
  GROK_BUILD_SUBSCRIPTION,
  parseSubscriptionAuthorizationInput,
  readChatGptAccountId,
  subscriptionOAuthProfile,
  type SubscriptionOAuthVendor,
} from "@zcode/provider";
import { z } from "zod";
import type { LocalCredentialService } from "#src/credential/credentialService.js";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import type {
  SubscriptionOAuthController,
  SubscriptionOAuthLoginStatus,
  SubscriptionRequestAuthDecision,
} from "./providerFacadeServices.js";

const log = createServiceLogger("subscription-oauth");
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const TOKEN_REQUEST_TIMEOUT_MS = 30_000;
const CHATGPT_ACCOUNT_HEADER = "ChatGPT-Account-ID";
const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CHATGPT_MODELS_URL = "https://chatgpt.com/backend-api/codex/models?client_version=0.169.0";
const GROK_SETTINGS_URL = `${GROK_BUILD_SUBSCRIPTION.baseUrl}/settings`;
const grokModelRouteSchema = z.object({
  model: z.string().nullish(),
  modelId: z.string().nullish(),
  hidden: z.boolean().nullish(),
});
const grokModelsSchema = z.object({
  data: z.array(
    grokModelRouteSchema.extend({
      id: z.string().nullish(),
      _meta: grokModelRouteSchema.nullish(),
    }),
  ),
});

const chatGptModelsSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string(),
      service_tiers: z.array(z.object({ id: z.string() })).optional(),
      additional_speed_tiers: z.array(z.string()).optional(),
    }),
  ),
});

const chatGptUsageWindowSchema = z.object({
  used_percent: z.number().min(0),
  limit_window_seconds: z.number().int().positive(),
  reset_at: z.number().int().nonnegative(),
});
const chatGptUsageSchema = z.object({
  plan_type: z.string().min(1).nullish(),
  rate_limit: z
    .object({
      primary_window: chatGptUsageWindowSchema.nullish(),
      secondary_window: chatGptUsageWindowSchema.nullish(),
    })
    .nullish(),
  rate_limit_reset_credits: z.object({ available_count: z.number().int().nonnegative() }).nullish(),
});
const grokSettingsSchema = z.object({
  subscription_tier_display: z.string().trim().nullish(),
});

interface StoredSubscriptionToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId?: string;
}

interface LoadedSubscriptionToken {
  readonly raw: string;
  readonly token: StoredSubscriptionToken;
}

interface BrowserFlow {
  readonly vendor: SubscriptionOAuthVendor;
  readonly verifier: string;
  readonly state: string;
  readonly redirectUri: string;
  readonly authorizeUrl: string;
  server: Server | null;
  settle: ((value: { code: string; state: string } | null) => void) | null;
  readonly done: Promise<{ code: string; state: string } | null>;
  timer: NodeJS.Timeout;
}

interface DeviceFlow {
  readonly vendor: "xai";
  readonly deviceCode: string;
  readonly verificationUrl: string;
  readonly userCode: string;
  timer: NodeJS.Timeout | null;
  aborted: boolean;
}

interface ActiveFlow {
  readonly mode: "browser" | "device";
  readonly status: SubscriptionOAuthLoginStatus;
  browser?: BrowserFlow;
  device?: DeviceFlow;
}

export function createSubscriptionOAuthService(options: {
  readonly credentialService: Pick<
    LocalCredentialService,
    "load" | "save" | "delete" | "updateMany"
  >;
  readVendor(providerId: string): Promise<SubscriptionOAuthVendor | null>;
  /** Host 网络传输。裸 fetch 不走桌面代理，连接失败时界面只能看到 fetch failed。 */
  readonly fetch?: typeof globalThis.fetch;
  /** 凭据写入或删除之后通知模型目录。不传令牌。 */
  onAuthorizationChanged?(providerId: string, authorized: boolean): void;
}): SubscriptionOAuthController & { discoverFastModels(providerId: string): Promise<string[]> } {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const flows = new Map<string, ActiveFlow>();
  const failures = new Map<string, string>();
  const refreshes = new Map<string, Promise<StoredSubscriptionToken | null>>();

  function credentialKey(providerId: string): string {
    return `subscription-oauth:${providerId.trim()}`;
  }

  async function readToken(providerId: string): Promise<LoadedSubscriptionToken | null> {
    const raw = await options.credentialService.load(credentialKey(providerId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSubscriptionToken>;
      if (!parsed.accessToken || !parsed.refreshToken || typeof parsed.expiresAt !== "number") {
        return null;
      }
      return {
        raw,
        token: {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt,
          ...(parsed.accountId ? { accountId: parsed.accountId } : {}),
        },
      };
    } catch {
      return null;
    }
  }

  async function writeToken(providerId: string, token: StoredSubscriptionToken): Promise<void> {
    await options.credentialService.save(credentialKey(providerId), JSON.stringify(token));
  }

  async function statusOf(providerId: string): Promise<SubscriptionOAuthLoginStatus> {
    const flow = flows.get(providerId);
    if (flow) return flow.status;
    if (await readToken(providerId)) return { status: "signed-in" };
    const message = failures.get(providerId);
    return message ? { status: "failed", message } : { status: "signed-out" };
  }

  function closeFlow(providerId: string): void {
    const flow = flows.get(providerId);
    if (!flow) return;
    flows.delete(providerId);
    if (flow.browser) {
      clearTimeout(flow.browser.timer);
      flow.browser.settle?.(null);
      flow.browser.settle = null;
      flow.browser.server?.close();
    }
    if (flow.device) {
      flow.device.aborted = true;
      if (flow.device.timer) clearTimeout(flow.device.timer);
    }
  }

  function noteAuthorization(providerId: string, authorized: boolean): void {
    options.onAuthorizationChanged?.(providerId, authorized);
  }

  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      throw new Error(describeSubscriptionTransportError(error, url));
    }
  }

  async function exchange(
    vendor: SubscriptionOAuthVendor,
    body: Record<string, string>,
    contentType: "json" | "form",
    allowMissingRefresh = false,
  ): Promise<StoredSubscriptionToken> {
    const profile = subscriptionOAuthProfile(vendor);
    const response = await request(profile.tokenUrl, {
      method: "POST",
      headers: subscriptionOAuthHeaders(vendor, contentType),
      body: contentType === "json" ? JSON.stringify(body) : new URLSearchParams(body),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(readOAuthError(text, response.status));
    }
    return readStoredToken(vendor, text, allowMissingRefresh);
  }

  async function finishBrowser(
    providerId: string,
    flow: BrowserFlow,
    code: string,
    state: string | undefined,
  ): Promise<SubscriptionOAuthLoginStatus> {
    if (state && state !== flow.state) {
      throw new Error("Sign-in state did not match.");
    }
    const profile = subscriptionOAuthProfile(flow.vendor);
    const token =
      flow.vendor === "anthropic"
        ? await exchange(
            flow.vendor,
            {
              grant_type: "authorization_code",
              client_id: profile.clientId,
              code,
              state: state ?? flow.state,
              redirect_uri: flow.redirectUri,
              code_verifier: flow.verifier,
            },
            "json",
          )
        : await exchange(
            flow.vendor,
            {
              grant_type: "authorization_code",
              client_id: profile.clientId,
              code,
              code_verifier: flow.verifier,
              redirect_uri: flow.redirectUri,
            },
            "form",
          );
    closeFlow(providerId);
    failures.delete(providerId);
    await writeToken(providerId, token);
    noteAuthorization(providerId, true);
    log.info(undefined, "订阅授权已完成", { providerId, vendor: flow.vendor });
    return { status: "signed-in" };
  }

  function listenForCallback(flow: BrowserFlow, providerId: string): Server | null {
    const profile = subscriptionOAuthProfile(flow.vendor);
    if (!profile.callbackPort || !profile.callbackPath) return null;
    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url || "", "http://localhost");
        if (url.pathname !== profile.callbackPath) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }
        const error = url.searchParams.get("error");
        if (error) {
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Sign-in did not complete.");
          failures.set(providerId, error);
          flow.settle?.(null);
          return;
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || state !== flow.state) {
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Sign-in did not complete.");
          flow.settle?.(null);
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<p>Signed in. You can close this window.</p>");
        flow.settle?.({ code, state });
      } catch {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Sign-in did not complete.");
      }
    });
    server.on("error", (error) => {
      log.warn(undefined, "订阅授权回调端口不可用，改为粘贴授权码", {
        providerId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    server.listen(profile.callbackPort, "127.0.0.1");
    return server;
  }

  async function pollDevice(providerId: string, device: DeviceFlow): Promise<void> {
    const profile = subscriptionOAuthProfile("xai");
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        device.timer = setTimeout(resolve, ms);
      });
    let intervalMs = 5_000;
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (!device.aborted && Date.now() < deadline) {
      await wait(intervalMs);
      if (device.aborted) return;
      try {
        const response = await request(profile.tokenUrl, {
          method: "POST",
          headers: subscriptionOAuthHeaders("xai", "form"),
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            client_id: profile.clientId,
            device_code: device.deviceCode,
          }),
          signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
        });
        const text = await response.text();
        if (response.ok) {
          const token = readStoredToken("xai", text);
          if (device.aborted) return;
          closeFlow(providerId);
          failures.delete(providerId);
          await writeToken(providerId, token);
          noteAuthorization(providerId, true);
          log.info(undefined, "订阅授权已完成", { providerId, vendor: "xai" });
          return;
        }
        const error = readOAuthErrorCode(text);
        if (error === "authorization_pending") continue;
        if (error === "slow_down") {
          intervalMs += 5_000;
          continue;
        }
        if (device.aborted) return;
        failures.set(providerId, readOAuthError(text, response.status));
        closeFlow(providerId);
        return;
      } catch (error) {
        if (device.aborted) return;
        failures.set(providerId, error instanceof Error ? error.message : "Sign-in failed.");
        closeFlow(providerId);
        return;
      }
    }
    if (!device.aborted) {
      failures.set(providerId, "Sign-in timed out.");
      closeFlow(providerId);
    }
  }

  async function refreshToken(
    providerId: string,
    vendor: SubscriptionOAuthVendor,
    { raw, token: current }: LoadedSubscriptionToken,
  ): Promise<StoredSubscriptionToken | null> {
    const existing = refreshes.get(providerId);
    if (existing) return existing;
    const pending = (async () => {
      const profile = subscriptionOAuthProfile(vendor);
      try {
        const next =
          vendor === "anthropic"
            ? await exchange(
                vendor,
                {
                  grant_type: "refresh_token",
                  client_id: profile.clientId,
                  refresh_token: current.refreshToken,
                },
                "json",
                true,
              )
            : await exchange(
                vendor,
                {
                  grant_type: "refresh_token",
                  client_id: profile.clientId,
                  refresh_token: current.refreshToken,
                },
                "form",
                true,
              );
        const stored = {
          ...next,
          refreshToken: next.refreshToken || current.refreshToken,
          ...(next.accountId || current.accountId
            ? { accountId: next.accountId ?? current.accountId }
            : {}),
        };
        const key = credentialKey(providerId);
        const committed = await options.credentialService.updateMany(
          { [key]: JSON.stringify(stored) },
          { expected: { [key]: raw } },
        );
        return committed ? stored : ((await readToken(providerId))?.token ?? null);
      } catch (error) {
        log.warn(undefined, "订阅令牌刷新失败", {
          providerId,
          vendor,
          message: error instanceof Error ? error.message : "refresh failed",
        });
        failures.set(providerId, error instanceof Error ? error.message : "Sign-in expired.");
        return null;
      } finally {
        refreshes.delete(providerId);
      }
    })();
    refreshes.set(providerId, pending);
    return pending;
  }

  async function resolveVendorAuth(
    providerId: string,
    vendor: SubscriptionOAuthVendor,
  ): Promise<SubscriptionRequestAuthDecision> {
    const loaded = await readToken(providerId);
    if (!loaded) return { kind: "signed-out" };
    const token =
      loaded.token.expiresAt <= Date.now()
        ? await refreshToken(providerId, vendor, loaded)
        : loaded.token;
    if (!token) return { kind: "signed-out" };
    const accountId = token.accountId ?? readChatGptAccountId(token.accessToken);
    return {
      kind: "ready",
      apiKey: token.accessToken,
      ...(vendor === "openai-chatgpt" && accountId
        ? { headers: { [CHATGPT_ACCOUNT_HEADER]: accountId } }
        : {}),
    };
  }

  return {
    getStatus: statusOf,

    async discoverFastModels(providerId) {
      const vendor = await options.readVendor(providerId);
      if (vendor !== "openai-chatgpt" && vendor !== "xai") return [];
      const auth = await resolveVendorAuth(providerId, vendor);
      if (auth.kind !== "ready") return [];
      const url =
        vendor === "xai" ? `${GROK_BUILD_SUBSCRIPTION.baseUrl}/models-v2` : CHATGPT_MODELS_URL;
      const response = await request(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.apiKey}`,
          ...(vendor === "xai" ? GROK_BUILD_SUBSCRIPTION.headers : auth.headers),
        },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Subscription model catalog request failed (${response.status}).`);
      }
      const body: unknown = await response.json();
      if (vendor === "xai") {
        const { data } = grokModelsSchema.parse(body);
        return data.some(
          ({ id, model, modelId, hidden, _meta }) =>
            !(hidden ?? _meta?.hidden) &&
            [id, model, modelId, _meta?.model, _meta?.modelId].includes(
              GROK_BUILD_SUBSCRIPTION.fastModelId,
            ),
        )
          ? [GROK_BUILD_SUBSCRIPTION.modelId]
          : [];
      }
      const { models } = chatGptModelsSchema.parse(body);
      return models
        .filter(
          (model) =>
            model.service_tiers?.some(({ id }) => id === "priority") ||
            model.additional_speed_tiers?.includes("fast"),
        )
        .map((model) => model.slug)
        .sort();
    },

    async getUsage(providerId) {
      const vendor = await options.readVendor(providerId);
      if (vendor !== "openai-chatgpt" && vendor !== "xai") return { windows: [] };
      const auth = await resolveVendorAuth(providerId, vendor);
      if (auth.kind !== "ready") throw new Error("Subscription usage requires sign-in.");
      const response = await request(vendor === "xai" ? GROK_SETTINGS_URL : CHATGPT_USAGE_URL, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.apiKey}`,
          ...(vendor === "xai" ? { "x-xai-token-auth": "xai-grok-cli" } : auth.headers),
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Subscription usage request failed (${response.status}).`);
      }
      const body: unknown = await response.json();
      if (vendor === "xai") {
        const { subscription_tier_display: planType } = grokSettingsSchema.parse(body);
        return { windows: [], planType: planType || undefined };
      }
      const payload = chatGptUsageSchema.parse(body);
      const limit = payload.rate_limit;
      const windows = [limit?.primary_window, limit?.secondary_window].flatMap((window) =>
        window
          ? [
              {
                windowSeconds: window.limit_window_seconds,
                usedPercent: window.used_percent,
                resetsAt: window.reset_at * 1000,
              },
            ]
          : [],
      );
      return {
        windows,
        planType: payload.plan_type ?? undefined,
        availableResetCount: payload.rate_limit_reset_credits?.available_count,
      };
    },

    async start(providerId) {
      const vendor = await options.readVendor(providerId);
      if (!vendor) throw new Error("This provider does not use subscription sign-in.");
      closeFlow(providerId);
      failures.delete(providerId);
      const profile = subscriptionOAuthProfile(vendor);
      if (vendor === "xai") {
        const response = await request(profile.deviceCodeUrl ?? "", {
          method: "POST",
          headers: subscriptionOAuthHeaders("xai", "form"),
          body: new URLSearchParams({
            client_id: profile.clientId,
            scope: profile.scope,
            ...(profile.deviceReferrer ? { referrer: profile.deviceReferrer } : {}),
          }),
          signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(readOAuthError(text, response.status));
        const parsed = JSON.parse(text) as {
          device_code?: unknown;
          user_code?: unknown;
          verification_uri?: unknown;
          verification_uri_complete?: unknown;
        };
        const deviceCode = typeof parsed.device_code === "string" ? parsed.device_code : "";
        const userCode = typeof parsed.user_code === "string" ? parsed.user_code : "";
        const verificationUrl =
          (typeof parsed.verification_uri_complete === "string" &&
            parsed.verification_uri_complete) ||
          (typeof parsed.verification_uri === "string" && parsed.verification_uri) ||
          "";
        if (!deviceCode || !userCode || !verificationUrl) {
          throw new Error("Sign-in did not return a device code.");
        }
        const device: DeviceFlow = {
          vendor: "xai",
          deviceCode,
          userCode,
          verificationUrl,
          timer: null,
          aborted: false,
        };
        const status: SubscriptionOAuthLoginStatus = {
          status: "waiting",
          mode: "device",
          userCode,
          verificationUrl,
        };
        flows.set(providerId, { mode: "device", status, device });
        void pollDevice(providerId, device);
        return status;
      }

      // 授权地址由公开客户端参数在本机拼出。先交给界面打开浏览器，令牌交换发生在回调之后。
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const state = vendor === "anthropic" ? verifier : randomBytes(16).toString("base64url");
      const authorizeUrl = buildSubscriptionAuthorizeUrl({ vendor, challenge, state });
      let settle: BrowserFlow["settle"] = null;
      const done = new Promise<{ code: string; state: string } | null>((resolve) => {
        settle = resolve;
      });
      const browser: BrowserFlow = {
        vendor,
        verifier,
        state,
        redirectUri: profile.redirectUri ?? "",
        authorizeUrl,
        server: null,
        settle,
        done,
        timer: setTimeout(() => {
          failures.set(providerId, "Sign-in timed out.");
          closeFlow(providerId);
        }, LOGIN_TIMEOUT_MS),
      };
      browser.server = listenForCallback(browser, providerId);
      const status: SubscriptionOAuthLoginStatus = {
        status: "waiting",
        mode: "browser",
        verificationUrl: authorizeUrl,
      };
      flows.set(providerId, { mode: "browser", status, browser });
      void browser.done.then(async (callback) => {
        if (!callback || flows.get(providerId)?.browser !== browser) return;
        try {
          await finishBrowser(providerId, browser, callback.code, callback.state);
        } catch (error) {
          failures.set(providerId, error instanceof Error ? error.message : "Sign-in failed.");
          closeFlow(providerId);
          log.warn(undefined, "订阅授权交换失败", {
            providerId,
            vendor,
            message: error instanceof Error ? error.message : "exchange failed",
          });
        }
      });
      return status;
    },

    async submitCode(providerId, code) {
      const flow = flows.get(providerId)?.browser;
      if (!flow) throw new Error("Sign-in is not waiting for a code.");
      const parsed = parseSubscriptionAuthorizationInput(code);
      if (!parsed.code) throw new Error("Paste the authorization code.");
      return finishBrowser(providerId, flow, parsed.code, parsed.state);
    },

    async cancel(providerId) {
      closeFlow(providerId);
      failures.delete(providerId);
      return statusOf(providerId);
    },

    async signOut(providerId) {
      closeFlow(providerId);
      failures.delete(providerId);
      await options.credentialService.delete(credentialKey(providerId));
      noteAuthorization(providerId, false);
      return { status: "signed-out" };
    },

    async resolveRequestAuth(providerId) {
      const vendor = await options.readVendor(providerId);
      return vendor ? resolveVendorAuth(providerId, vendor) : { kind: "not-subscription" };
    },
  };
}

function readStoredToken(
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
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
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
    expiresAt: Date.now() + expiresIn * 1000 - REFRESH_SKEW_MS,
    ...(accountId ? { accountId } : {}),
  };
}

function subscriptionOAuthHeaders(
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

function describeSubscriptionTransportError(error: unknown, target: string): string {
  const host = endpointHost(target);
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current) && parts.length < 4) {
    seen.add(current);
    const code = "code" in current && typeof current.code === "string" ? current.code : "";
    const message = scrubAuthorizationDetail(current.message);
    if (code) parts.push(code);
    if (message && message !== "fetch failed" && message !== code) parts.push(message);
    current = "cause" in current ? current.cause : undefined;
  }
  const detail = parts.filter((part, index) => parts.indexOf(part) === index).join(": ");
  const text = detail.slice(0, 180);
  return text ? `Sign-in could not reach ${host} (${text}).` : `Sign-in could not reach ${host}.`;
}

function endpointHost(target: string): string {
  try {
    return new URL(target).host;
  } catch {
    return "the authorization service";
  }
}

function scrubAuthorizationDetail(text: string): string {
  return text.replace(/https?:\/\/\S+/g, (url) => endpointHost(url)).trim();
}

function readOAuthError(body: string, status: number): string {
  const code = readOAuthErrorCode(body);
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

function readOAuthErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : "";
  } catch {
    return "";
  }
}
