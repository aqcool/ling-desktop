import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { imagegenRequestSchema, maxImagegenInputBytes, type ImagegenBridge } from "./contract.js";

const imagesEndpoint = "https://chatgpt.com/backend-api/codex/images";
const maxRequestBytes = Math.ceil(maxImagegenInputBytes / 3) * 4 + 256 * 1024;
const maxResultBytes = 32 * 1024 * 1024;
const maxResponseBytes = Math.ceil(maxResultBytes / 3) * 4 + 256 * 1024;

class ImagegenUnauthorizedError extends Error {
  constructor() {
    super("ChatGPT sign-in expired. Reconnect the subscription.");
  }
}

async function readResponseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  // 修复原因：流式限制上游响应体积上限，避免超大或异常代理响应在 JSON.parse 前造成 Host 内存暴涨。
  const reader = response.body?.getReader();
  if (!reader) throw new Error("ChatGPT did not return a supported PNG image.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("ChatGPT returned an oversized image response.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as unknown;
  } catch {
    throw new Error("ChatGPT did not return a supported PNG image.");
  }
}

interface SubscriptionAuth {
  apiKey: string;
  headers?: Readonly<Record<string, string>>;
}

export async function requestChatGptImage(
  input: unknown,
  auth: SubscriptionAuth,
  fetchImage: typeof fetch,
  signal: AbortSignal,
  onTransportError?: (error: unknown, mode: "edit" | "generate") => void,
): Promise<string> {
  const parsed = imagegenRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid image prompt or reference image.");
  const { prompt, image, turnId, transparentBackground } = parsed.data;
  const response = await fetchImage(`${imagesEndpoint}/${image ? "edits" : "generations"}`, {
    method: "POST",
    headers: {
      ...auth.headers,
      authorization: `Bearer ${auth.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
      originator: "codex_cli_rs",
      "x-codex-image-turn-id": turnId ?? randomUUID(),
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      background: transparentBackground ? "transparent" : "auto",
      quality: "auto",
      size: "auto",
      ...(image ? { images: [{ image_url: image }] } : {}),
    }),
    redirect: "error",
    signal,
  }).catch((error: unknown) => {
    signal.throwIfAborted();
    onTransportError?.(error, image ? "edit" : "generate");
    throw new Error("Could not reach ChatGPT image generation.");
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401) throw new ImagegenUnauthorizedError();
    if (response.status === 403)
      throw new Error("ChatGPT denied image generation for this subscription.");
    if (response.status === 429)
      throw new Error("ChatGPT image generation is rate-limited. Try again later.");
    throw new Error(`ChatGPT image generation failed (HTTP ${response.status}).`);
  }

  const result = (await readResponseJson(response, signal)) as { data?: { b64_json?: unknown }[] };
  const data = result?.data?.[0]?.b64_json;
  if (
    typeof data !== "string" ||
    data.length > Math.ceil(maxResultBytes / 3) * 4 ||
    !data.startsWith("iVBORw0KGgo") ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  ) {
    throw new Error("ChatGPT did not return a supported PNG image.");
  }
  return data;
}

async function readRequest(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxRequestBytes) throw new Error("The image request is too large.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
}

export function createImagegenBridge(options: {
  fetch: typeof fetch;
  resolveAuth(authOptions?: { readonly forceRefresh?: boolean }): Promise<SubscriptionAuth>;
  onTransportError?: (error: unknown, mode: "edit" | "generate") => void;
}): ImagegenBridge {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);
  const lifetime = new AbortController();
  let listening: Promise<string> | undefined;
  const server = createServer((request, response) => {
    const authorization = Buffer.from(request.headers.authorization ?? "");
    response.setHeader("content-type", "application/json");
    if (
      request.method !== "POST" ||
      request.url !== "/imagegen" ||
      authorization.length !== expected.length ||
      !timingSafeEqual(authorization, expected)
    ) {
      response.writeHead(403).end(JSON.stringify({ error: "Image generation capability denied." }));
      return;
    }
    const connection = new AbortController();
    response.once("close", () => connection.abort());
    const signal = AbortSignal.any([
      connection.signal,
      lifetime.signal,
      AbortSignal.timeout(240_000),
    ]);
    void (async () => {
      try {
        const input = await readRequest(request);
        signal.throwIfAborted();
        const auth = await options.resolveAuth();
        signal.throwIfAborted();
        let data: string;
        try {
          data = await requestChatGptImage(
            input,
            auth,
            options.fetch,
            signal,
            options.onTransportError,
          );
        } catch (error) {
          // 修复原因：上游因服务端轮换或时钟偏差返回 401 时，先强制刷新一次令牌再重试，避免无谓要求重登。
          if (!(error instanceof ImagegenUnauthorizedError) || signal.aborted) throw error;
          const refreshed = await options.resolveAuth({ forceRefresh: true }).catch(() => null);
          if (!refreshed || refreshed.apiKey === auth.apiKey) throw error;
          signal.throwIfAborted();
          data = await requestChatGptImage(
            input,
            refreshed,
            options.fetch,
            signal,
            options.onTransportError,
          );
        }
        response.end(JSON.stringify({ data }));
      } catch (error) {
        if (response.destroyed) return;
        const message = signal.aborted
          ? "Image generation was cancelled or timed out."
          : error instanceof Error
            ? error.message
            : "Image generation failed.";
        response.writeHead(400).end(JSON.stringify({ error: message }));
      }
    })();
  });
  server.unref();
  return {
    environment() {
      lifetime.signal.throwIfAborted();
      listening ??= new Promise<string>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.removeListener("error", reject);
          const address = server.address();
          if (typeof address !== "object" || !address)
            return reject(new Error("Imagegen could not listen."));
          resolve(JSON.stringify({ url: `http://127.0.0.1:${address.port}/imagegen`, token }));
        });
      }).catch((error: unknown) => {
        listening = undefined;
        throw error;
      });
      return listening;
    },
    dispose() {
      lifetime.abort();
      server.close();
      server.closeAllConnections();
    },
  };
}
