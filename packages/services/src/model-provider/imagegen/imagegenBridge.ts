import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { imagegenRequestSchema, maxImagegenInputBytes, type ImagegenBridge } from "./contract.js";

const imagesEndpoint = "https://chatgpt.com/backend-api/codex/images";
const maxRequestBytes = Math.ceil(maxImagegenInputBytes / 3) * 4 + 256 * 1024;
const maxResultBytes = 32 * 1024 * 1024;

interface SubscriptionAuth {
  apiKey: string;
  headers?: Readonly<Record<string, string>>;
}

export async function requestChatGptImage(
  input: unknown,
  auth: SubscriptionAuth,
  fetchImage: typeof fetch,
  signal: AbortSignal,
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
  }).catch(() => {
    signal.throwIfAborted();
    throw new Error("Could not reach ChatGPT image generation.");
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401)
      throw new Error("ChatGPT sign-in expired. Reconnect the subscription.");
    if (response.status === 403)
      throw new Error("ChatGPT denied image generation for this subscription.");
    if (response.status === 429)
      throw new Error("ChatGPT image generation is rate-limited. Try again later.");
    throw new Error(`ChatGPT image generation failed (HTTP ${response.status}).`);
  }

  const result = (await response.json()) as { data?: { b64_json?: unknown }[] };
  const data = result.data?.[0]?.b64_json;
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
  resolveAuth(): Promise<SubscriptionAuth>;
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
        const data = await requestChatGptImage(input, auth, options.fetch, signal);
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
