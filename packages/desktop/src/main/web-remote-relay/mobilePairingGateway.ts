import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { WebSocket, WebSocketServer } from "ws";
import {
  LING_MOBILE_PAIRING,
  WEB_REMOTE_CONTROL_RELAY_V2_HTTP as routes,
  WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH,
  lingMobilePairingExchangeSchema,
  lingMobilePairingTokenSchema,
  parseWebRemoteControlRelayV2HttpRequest,
  parseWebRemoteControlRelayV2OutgoingMessage,
  type WebRemoteControlRelayV2IncomingMessage,
} from "@zcode/shared/web-remote-relay";
import type { WebRemoteControlRegisteredDevice } from "./contract.js";

const COOKIE = "ling-mobile";
const PAIRING_TTL = 120_000;
const SESSION_TTL = 86_400_000;
const TOKEN_TTL = 60_000;
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};

type Grant = { value: string; expiresAt: number };
type Ticket = { side: "device" | "terminal"; sid: string; expiresAt: number; session?: string };
type Device = {
  pairing?: Grant;
  session?: Grant;
  device?: WebSocket;
  terminal?: WebSocket;
  terminalId?: string;
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json")) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 4096) return null;
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function matches(expected: string, candidate: string | undefined): boolean {
  if (!candidate) return false;
  const bytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return bytes.length === expectedBytes.length && timingSafeEqual(bytes, expectedBytes);
}

function send(socket: WebSocket | undefined, message: WebRemoteControlRelayV2IncomingMessage) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 8 * 1024 * 1024) {
    socket.terminate();
    return;
  }
  socket.send(JSON.stringify(message));
}

function reply(response: ServerResponse, status: number, data?: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ code: status === 200 ? 0 : status, msg: "", data }));
}

export function createMobilePairingGateway(value: string, webRoot: string, port = 17328) {
  const publicUrl = new URL(value);
  const origin = `http://127.0.0.1:${port}`;
  if (
    (publicUrl.protocol !== "https:" && publicUrl.origin !== origin) ||
    publicUrl.href !== `${publicUrl.origin}/`
  ) {
    throw new Error("LING_MOBILE_REMOTE_URL must be an HTTPS origin");
  }
  const login = { userId: "ling-desktop", jwt: randomBytes(32).toString("base64url") };
  const devices = new Map<string, Device>();
  const tickets = new Map<string, Ticket>();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });
  let registered: WebRemoteControlRegisteredDevice | undefined;
  let started: Promise<void> | undefined;
  const root = resolve(webRoot);
  const isLocal = (req: IncomingMessage) => req.headers.host === new URL(origin).host;
  const isPublicHost = (req: IncomingMessage) => req.headers.host === publicUrl.host;

  function issueTicket(response: ServerResponse, fields: Omit<Ticket, "expiresAt">) {
    const now = Date.now();
    for (const [token, ticket] of tickets) {
      if (ticket.expiresAt <= now) tickets.delete(token);
    }
    if (tickets.size >= 128) return reply(response, 429);
    const token = randomBytes(16).toString("base64url");
    tickets.set(token, { ...fields, expiresAt: now + TOKEN_TTL });
    reply(response, 200, { token, expires_in: TOKEN_TTL / 1000 });
  }

  function revoke(sid: string) {
    const device = devices.get(sid);
    if (!device) return;
    device.pairing = undefined;
    device.session = undefined;
    device.terminal?.close();
    for (const [token, ticket] of tickets) {
      if (ticket.sid === sid) tickets.delete(token);
    }
  }

  async function serve(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const path = new URL(req.url ?? "/", origin).pathname;
    if (req.method === "POST" && Object.values(routes).some((route) => route.path === path)) {
      if (!isLocal(req) || !matches(`Bearer ${login.jwt}`, req.headers.authorization))
        return reply(res, 401);
      const body = await readBody(req);
      if (path === routes.register.path) {
        const request = parseWebRemoteControlRelayV2HttpRequest("register", body);
        if (!request) return reply(res, 400);
        const sid = randomUUID();
        devices.set(sid, {});
        return reply(res, 200, {
          device_sid: sid,
          device_mid: request.device_mid,
          online: false,
          created_at: Math.floor(Date.now() / 1000),
          meta: {},
        });
      }
      if (path === routes.delete.path) {
        const request = parseWebRemoteControlRelayV2HttpRequest("delete", body);
        if (!request) return reply(res, 400);
        const device = devices.get(request.device_sid);
        revoke(request.device_sid);
        device?.device?.close();
        devices.delete(request.device_sid);
        return reply(res, 200);
      }
      const request = parseWebRemoteControlRelayV2HttpRequest("token", body);
      if (request?.role !== "device" || !registered) return reply(res, 400);
      return issueTicket(res, { side: "device", sid: registered.deviceSid });
    }

    if (!isPublicHost(req)) return reply(res, 404);
    if (req.method === "POST" && req.headers.origin === publicUrl.origin) {
      if (path === LING_MOBILE_PAIRING.exchangePath) {
        const result = lingMobilePairingExchangeSchema.safeParse(await readBody(req));
        if (!result.success) return reply(res, 400);
        const device = devices.get(result.data.sid);
        const pairing = device?.pairing;
        if (
          !device?.device ||
          !pairing ||
          pairing.expiresAt <= Date.now() ||
          !matches(pairing.value, result.data.code)
        )
          return reply(res, 401);
        revoke(result.data.sid);
        const session = randomBytes(32).toString("base64url");
        device.session = { value: session, expiresAt: Date.now() + SESSION_TTL };
        res.setHeader(
          "Set-Cookie",
          `${COOKIE}=${session}; Path=${LING_MOBILE_PAIRING.tokenPath}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${publicUrl.protocol === "https:" ? "; Secure" : ""}`,
        );
        return reply(res, 200);
      }
      if (path === LING_MOBILE_PAIRING.tokenPath) {
        const result = lingMobilePairingTokenSchema.safeParse(await readBody(req));
        if (!result.success) return reply(res, 400);
        const session = devices.get(result.data.sid)?.session;
        const cookie = req.headers.cookie
          ?.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${COOKIE}=`))
          ?.slice(COOKIE.length + 1);
        if (!session || session.expiresAt <= Date.now() || !matches(session.value, cookie))
          return reply(res, 401);
        return issueTicket(res, { side: "terminal", sid: result.data.sid, session: session.value });
      }
    }
    if (req.method !== "GET" && req.method !== "HEAD") return reply(res, 404);
    const decoded = decodeURIComponent(path);
    const page = decoded === "/remote/v4" || decoded === "/remote/v4/";
    const file = resolve(root, page ? "index.html" : `.${decoded}`);
    if (
      !file.startsWith(root + sep) ||
      decoded.split("/").some((part) => part.startsWith(".")) ||
      extname(file) === ".map" ||
      (!page && extname(file) === ".html")
    )
      return reply(res, 404);
    const entry = await stat(file).catch(() => undefined);
    if (!entry?.isFile()) return reply(res, 404);
    if (/^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[\w.]+$/.test(decoded)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Length": entry.size,
    });
    if (req.method === "HEAD") res.end();
    else await pipeline(createReadStream(file), res);
  }

  const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, (req, res) => {
    void serve(req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else reply(res, 400);
    });
  });
  server.on("upgrade", (req, socket, head) => {
    const url = URL.parse(req.url ?? "/", origin);
    const token = url?.searchParams.get("token") ?? "";
    const ticket = tickets.get(token);
    const device = ticket && devices.get(ticket.sid);
    if (
      !ticket ||
      !device ||
      ticket.expiresAt <= Date.now() ||
      url?.pathname !== WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH ||
      (ticket.side === "device"
        ? !isLocal(req)
        : !isPublicHost(req) ||
          req.headers.origin !== publicUrl.origin ||
          device.session?.value !== ticket.session)
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    tickets.delete(token);
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const side = ticket.side;
      const peer = side === "device" ? "terminal" : "device";
      const authTimeout = setTimeout(() => ws.terminate(), 5000);
      ws.on("error", () => ws.terminate());
      ws.on("close", () => {
        clearTimeout(authTimeout);
        if (device[side] !== ws) return;
        delete device[side];
        if (side === "terminal") delete device.terminalId;
        send(device[peer], { type: "pair_status_ack", pair_status: "waiting" });
        if (side === "device") {
          send(device.terminal, { type: "error", code: "DEVICE_OFFLINE" });
          device.terminal?.close();
        }
      });
      ws.on("message", (bytes, binary) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        let value: unknown;
        try {
          value = binary ? null : JSON.parse(bytes.toString());
        } catch {
          value = null;
        }
        const message = parseWebRemoteControlRelayV2OutgoingMessage(value);
        if (device[side] !== ws) {
          if (
            message?.type !== "auth_init" ||
            message.device_sid !== ticket.sid ||
            (side === "terminal" && device.session?.value !== ticket.session)
          ) {
            send(ws, { type: "error", code: "AUTH_FAILED" });
            ws.close();
            return;
          }
          clearTimeout(authTimeout);
          const old = device[side];
          device[side] = ws;
          if (side === "terminal") device.terminalId = randomUUID();
          send(old, { type: "error", code: "KICKED" });
          old?.close();
          const pair_status = device[peer] ? "matched" : "waiting";
          send(ws, {
            type: "auth_ack",
            device_sid: ticket.sid,
            terminal_sid: side === "terminal" ? device.terminalId : undefined,
            pair_status,
          });
          send(device[peer], {
            type: "pair_status_ack",
            pair_status,
            terminal_sid: device.terminalId,
          });
          return;
        }
        if (message?.type === "pair_status_query") {
          send(ws, {
            type: "pair_status_ack",
            pair_status: device[peer] ? "matched" : "waiting",
            terminal_sid: device.terminalId,
          });
        } else if (message?.type === "data") {
          send(device[peer], { type: "data", payload: message.payload });
        } else {
          send(ws, { type: "error", code: "WRONG_PARAM" });
          ws.close();
        }
      });
    });
  });

  return {
    login,
    origin,
    remoteUrl: new URL("/remote/v4", publicUrl).href,
    relayWsUrl: `ws://127.0.0.1:${port}${WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH}`,
    storage: {
      load: async () => registered,
      save: async (device: WebRemoteControlRegisteredDevice) => {
        registered = device;
      },
      clearLegacy: async () => {},
    },
    async start() {
      started ??= (async () => {
        await stat(resolve(root, "index.html"));
        server.listen(port, "127.0.0.1");
        await once(server, "listening");
      })().catch((error: unknown) => {
        started = undefined;
        throw error;
      });
      await started;
    },
    pairingUrl(sid: string, baseUrl: string) {
      const device = devices.get(sid);
      if (!device?.device) return "";
      if (!device.pairing || device.pairing.expiresAt <= Date.now()) {
        device.pairing = {
          value: randomBytes(32).toString("base64url"),
          expiresAt: Date.now() + PAIRING_TTL,
        };
      }
      const url = new URL(baseUrl);
      url.searchParams.set(LING_MOBILE_PAIRING.queryKey, "1");
      url.hash = device.pairing.value;
      return url.href;
    },
    revoke,
    dispose() {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.close();
    },
  };
}
