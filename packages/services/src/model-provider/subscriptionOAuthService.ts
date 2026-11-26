import { reportedReasoningEffortSchema } from "@zcode/shared/model-config";
import { withFileLock } from "@zcode/shared/node";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import {
  buildSubscriptionAuthorizeUrl,
  buildSubscriptionOAuthHeaders as subscriptionOAuthHeaders,
  describeSubscriptionTransportError,
  GROK_BUILD_SUBSCRIPTION,
  parseSubscriptionAuthorizationInput,
  PERMANENT_OAUTH_ERROR_CODES,
  readChatGptAccountId,
  readStoredSubscriptionToken as readStoredToken,
  readSubscriptionOAuthError as readOAuthError,
  readSubscriptionOAuthErrorCode as readOAuthErrorCode,
  SubscriptionOAuthExchangeError as OAuthExchangeError,
  subscriptionOAuthProfile,
  type StoredSubscriptionToken,
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

const chatGptModelSchema = z.object({
  slug: z.string().min(1),
  supported_reasoning_levels: z.array(z.unknown()).nullish(),
  // 修复原因：Codex 后端可能对部分模型返回 null 而非省略字段，逐项容错避免单个字段异常拖垮整份目录。
  service_tiers: z.array(z.object({ id: z.string() })).nullish(),
  additional_speed_tiers: z.array(z.string()).nullish(),
});
const chatGptModelsSchema = z.object({
  models: z.array(z.unknown()),
});

const codexReasoningLevelSchema = z.object({ effort: reportedReasoningEffortSchema });

export interface SubscriptionModelCatalog {
  readonly fastModelIds: readonly string[];
  readonly reasoningLevels?: Readonly<Record<string, readonly string[]>>;
}

const emptyCatalog: SubscriptionModelCatalog = { fastModelIds: [] };

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
  finishing: Promise<SubscriptionOAuthLoginStatus> | null;
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
  /** 跨进程刷新锁目录：多窗口并发刷新一次性 refresh_token 时避免触发服务端重放吊销。 */
  readonly lockDirectory?: string;
  /** Host 网络传输。裸 fetch 不走桌面代理，连接失败时界面只能看到 fetch failed。 */
  readonly fetch?: typeof globalThis.fetch;
  /** 凭据写入或删除之后通知模型目录。不传令牌。 */
  onAuthorizationChanged?(providerId: string, authorized: boolean): void;
}): SubscriptionOAuthController & {
  discoverModelCatalog(providerId: string): Promise<SubscriptionModelCatalog>;
  refreshRequestAuth(providerId: string): Promise<SubscriptionRequestAuthDecision>;
  waitForPendingRefreshes(timeoutMs?: number): Promise<void>;
} {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const flows = new Map<string, ActiveFlow>();
  const failures = new Map<string, string>();
  const permanentFailures = new Set<string>();
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
    const loaded = await readToken(providerId);
    const message = failures.get(providerId);
    // 区分永久吊销与瞬时网络错误：只有服务端明确拒绝（如 invalid_grant）且令牌已过期时才标记需重登，
    // 断网/代理抖动不把用户误判为掉登录。
    if (loaded) {
      if (loaded.token.expiresAt <= Date.now() && permanentFailures.has(providerId) && message) {
        return { status: "failed", message };
      }
      return { status: "signed-in" };
    }
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
      const code = readOAuthErrorCode(text);
      const permanent =
        (response.status === 400 || response.status === 401) &&
        PERMANENT_OAUTH_ERROR_CODES.has(code);
      throw new OAuthExchangeError(readOAuthError(text, response.status), permanent);
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
    // 修复原因：防止浏览器回调与手动粘贴授权码并发兑换同一个一次性 code。
    if (flow.finishing) return flow.finishing;
    const pending = (async (): Promise<SubscriptionOAuthLoginStatus> => {
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
      // 修复原因：换票期间若用户已取消、登出或发起新登录流，禁止旧请求误杀新流或把凭据写回登录态。
      if (flows.get(providerId)?.browser !== flow) {
        throw new Error("Sign-in was cancelled.");
      }
      closeFlow(providerId);
      failures.delete(providerId);
      permanentFailures.delete(providerId);
      await writeToken(providerId, token);
      noteAuthorization(providerId, true);
      log.info(undefined, "订阅授权已完成", { providerId, vendor: flow.vendor });
      return { status: "signed-in" };
    })();
    flow.finishing = pending;
    try {
      return await pending;
    } finally {
      if (flow.finishing === pending) flow.finishing = null;
    }
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
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        if (error) {
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Sign-in did not complete.");
          // 修复原因：仅当 state 匹配当前登录流时才终止流程，防止无关请求或 CSRF 毒化本地回调服务。
          if (state === flow.state && flows.get(providerId)?.browser === flow) {
            failures.set(providerId, error);
            closeFlow(providerId);
          }
          return;
        }
        const code = url.searchParams.get("code");
        if (!code || state !== flow.state) {
          // 修复原因：无效或 state 不匹配的请求只返回 400，不提前 settle(null) 破坏后续合法回调。
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Sign-in did not complete.");
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
    loaded: LoadedSubscriptionToken,
    forceRefresh = false,
  ): Promise<StoredSubscriptionToken | null> {
    const existing = refreshes.get(providerId);
    if (existing) return existing;
    const runRefresh = async (): Promise<StoredSubscriptionToken | null> => {
      // 跨进程文件锁内二次检查（Double-Checked Locking）：若另一窗口已先完成轮换，直接复用新令牌，
      // 不再发出重复的 refresh_token 请求，避免触发服务端重放吊销整个 token family。
      const latestBefore = await readToken(providerId);
      if (latestBefore && !forceRefresh && latestBefore.token.expiresAt > Date.now()) {
        failures.delete(providerId);
        permanentFailures.delete(providerId);
        return latestBefore.token;
      }
      const effective = latestBefore ?? loaded;
      const { raw, token: current } = effective;
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
        const result = committed ? stored : ((await readToken(providerId))?.token ?? null);
        if (result) {
          failures.delete(providerId);
          permanentFailures.delete(providerId);
        }
        return result;
      } catch (error) {
        const latestAfter = await readToken(providerId);
        if (latestAfter && latestAfter.raw !== raw && latestAfter.token.expiresAt > Date.now()) {
          failures.delete(providerId);
          permanentFailures.delete(providerId);
          return latestAfter.token;
        }
        const permanent = error instanceof OAuthExchangeError && error.permanent;
        log.warn(undefined, "订阅令牌刷新失败", {
          providerId,
          vendor,
          permanent,
          message: error instanceof Error ? error.message : "refresh failed",
        });
        if (permanent) {
          permanentFailures.add(providerId);
          failures.set(providerId, error instanceof Error ? error.message : "Sign-in expired.");
        }
        return null;
      }
    };
    const pending = (async () => {
      try {
        if (!options.lockDirectory) return await runRefresh();
        const safeId = providerId.replace(/[^a-zA-Z0-9._-]/g, "_");
        return await withFileLock(
          join(options.lockDirectory, `subscription-oauth-${safeId}.lock`),
          runRefresh,
          { lockMaxWaitMs: 15_000 },
        );
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
    forceRefresh = false,
  ): Promise<SubscriptionRequestAuthDecision> {
    const loaded = await readToken(providerId);
    if (!loaded) return { kind: "signed-out" };
    const token =
      forceRefresh || loaded.token.expiresAt <= Date.now()
        ? await refreshToken(providerId, vendor, loaded, forceRefresh)
        : loaded.token;
    if (!token) return { kind: "signed-out" };
    failures.delete(providerId);
    permanentFailures.delete(providerId);
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

    async discoverModelCatalog(providerId) {
      const vendor = await options.readVendor(providerId);
      if (vendor !== "openai-chatgpt" && vendor !== "xai") return emptyCatalog;
      const auth = await resolveVendorAuth(providerId, vendor);
      if (auth.kind !== "ready") return emptyCatalog;
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
        const supportsFast = data.some(
          ({ id, model, modelId, hidden, _meta }) =>
            !(hidden ?? _meta?.hidden) &&
            [id, model, modelId, _meta?.model, _meta?.modelId].includes(
              GROK_BUILD_SUBSCRIPTION.fastModelId,
            ),
        );
        return supportsFast ? { fastModelIds: [GROK_BUILD_SUBSCRIPTION.modelId] } : emptyCatalog;
      }
      const { models: rawModels } = chatGptModelsSchema.parse(body);
      const models = rawModels.flatMap((entry) => {
        const parsed = chatGptModelSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      });
      const fastModelIds = models
        .filter(
          (model) =>
            model.service_tiers?.some(({ id }) => id === "priority") ||
            model.additional_speed_tiers?.includes("fast"),
        )
        .map((model) => model.slug)
        .sort();
      const reasoningLevels = Object.fromEntries(
        [...models]
          .sort((a, b) => a.slug.localeCompare(b.slug))
          .flatMap((model) => {
            const levels = new Set<string>();
            for (const value of model.supported_reasoning_levels ?? []) {
              const parsed = codexReasoningLevelSchema.safeParse(value);
              if (parsed.success) levels.add(parsed.data.effort);
            }
            return levels.size ? [[model.slug, [...levels]] as const] : [];
          }),
      );
      return { fastModelIds, reasoningLevels };
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
      // 修复原因：state 与 PKCE code_verifier 必须相互独立，避免明文 verifier 暴露在浏览器地址栏与本地回调 URL 中。
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const state = randomBytes(16).toString("base64url");
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
        finishing: null,
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
      permanentFailures.delete(providerId);
      await options.credentialService.delete(credentialKey(providerId));
      noteAuthorization(providerId, false);
      return { status: "signed-out" };
    },

    async resolveRequestAuth(providerId) {
      const vendor = await options.readVendor(providerId);
      return vendor ? resolveVendorAuth(providerId, vendor, false) : { kind: "not-subscription" };
    },

    async refreshRequestAuth(providerId) {
      const vendor = await options.readVendor(providerId);
      return vendor ? resolveVendorAuth(providerId, vendor, true) : { kind: "not-subscription" };
    },

    async waitForPendingRefreshes(timeoutMs = 4_000) {
      const pending = [...refreshes.values()];
      if (pending.length === 0) return;
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
  };
}
