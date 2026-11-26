import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIPv4 } from "node:net";
import { extname, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import { WebSocket, WebSocketServer } from "ws";
import { WEB_REMOTE_CONTROL_RPC_TRANSPORT_LIMITS } from "@zcode/shared";
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
import type {
  AcceptWebRemoteControlLanTerminal,
  WebRemoteControlRegisteredDevice,
} from "./contract.js";

import type { RemoteTransportHost } from "./remoteTransportHost.js";

const COOKIE = "ling-mobile";
const LOOPBACK = "127.0.0.1";
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
  lan?: { accept: AcceptWebRemoteControlLanTerminal; sockets: Set<WebSocket> };
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

function isPrivateIpv4(address: string | undefined): boolean {
  if (!address || !isIPv4(address)) return false;
  const [first, second = 0] = address.split(".").map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
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

export function createMobilePairingGateway(
  value: string,
  webRoot: string,
  port = 17328,
  remoteTransport?: RemoteTransportHost,
) {
  const publicUrl = new URL(value);
  const localUrl = new URL(`http://${LOOPBACK}:${port}`);
  const nativeOnly = Boolean(remoteTransport) && publicUrl.origin === localUrl.origin;
  const isLan =
    publicUrl.protocol === "http:" &&
    publicUrl.port === String(port) &&
    isPrivateIpv4(publicUrl.hostname);
  if (
    (!isLan && publicUrl.protocol !== "https:" && publicUrl.origin !== localUrl.origin) ||
    publicUrl.href !== `${publicUrl.origin}/`
  ) {
    throw new Error(
      `LING_MOBILE_REMOTE_URL must be an HTTPS origin or a private IPv4 HTTP origin on port ${port}`,
    );
  }
  const login = { userId: "ling-desktop", jwt: randomBytes(32).toString("base64url") };
  const devices = new Map<string, Device>();
  const tickets = new Map<string, Ticket>();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });
  let registered: WebRemoteControlRegisteredDevice | undefined;
  let started: Promise<void> | undefined;
  const root = resolve(webRoot);
  const isLocal = (req: IncomingMessage) =>
    req.headers.host === localUrl.host &&
    req.socket.localAddress === LOOPBACK &&
    req.socket.remoteAddress === LOOPBACK;
  const isPublicHost = (req: IncomingMessage) =>
    req.headers.host === publicUrl.host &&
    (!isLan ||
      (req.socket.localAddress === publicUrl.hostname && isPrivateIpv4(req.socket.remoteAddress)));

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
    for (const socket of device.lan?.sockets ?? []) socket.close();
    device.lan = undefined;
    for (const [token, ticket] of tickets) {
      if (ticket.sid === sid) tickets.delete(token);
    }
  }

  async function serve(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const path = new URL(req.url ?? "/", localUrl.origin).pathname;
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

    const fromPublicHost = isPublicHost(req);
    if (!fromPublicHost && !(isLan && isLocal(req))) return reply(res, 404);
    if (fromPublicHost && req.method === "POST" && req.headers.origin === publicUrl.origin) {
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
        // LAN 重开链接时复用有效授权，避免在新 socket 完成认证前踢掉旧连接。
        if (!isLan) revoke(result.data.sid);
        const now = Date.now();
        if (!device.session || device.session.expiresAt <= now) {
          device.session = {
            value: randomBytes(32).toString("base64url"),
            expiresAt: now + SESSION_TTL,
          };
        }
        const { value: session, expiresAt } = device.session;
        res.setHeader(
          "Set-Cookie",
          `${COOKIE}=${session}; Path=${LING_MOBILE_PAIRING.tokenPath}; HttpOnly; SameSite=Strict; Max-Age=${Math.ceil((expiresAt - now) / 1000)}${publicUrl.protocol === "https:" ? "; Secure" : ""}`,
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

  function acceptLanSocket(ws: WebSocket, device: Device, ticket: Ticket) {
    let receiver: ReturnType<AcceptWebRemoteControlLanTerminal> | undefined;
    const lan = device.lan;
    const authTimeout = setTimeout(() => ws.terminate(), 5000);
    ws.on("error", () => ws.terminate());
    ws.on("close", () => {
      clearTimeout(authTimeout);
      lan?.sockets.delete(ws);
      receiver?.close();
    });
    ws.on("message", (data, binary) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      let value: unknown;
      try {
        value = binary ? null : JSON.parse(data.toString());
      } catch {
        value = null;
      }
      const message = parseWebRemoteControlRelayV2OutgoingMessage(value);
      if (!receiver) {
        if (
          message?.type !== "auth_init" ||
          message.device_sid !== ticket.sid ||
          device.session?.value !== ticket.session ||
          !lan ||
          device.lan !== lan ||
          device.device?.readyState !== WebSocket.OPEN
        ) {
          send(ws, { type: "error", code: "AUTH_FAILED" });
          ws.close();
          return;
        }
        clearTimeout(authTimeout);
        receiver = lan.accept({
          sendPayloadResult(payload) {
            const json = JSON.stringify({ type: "data", payload });
            const bytes = Buffer.byteLength(json);
            const maxBytes = WEB_REMOTE_CONTROL_RPC_TRANSPORT_LIMITS.maxPhysicalFrameBytes;
            if (bytes > maxBytes) return { kind: "oversize", bytes, maxBytes };
            if (ws.readyState !== WebSocket.OPEN) return { kind: "unavailable" };
            if (ws.bufferedAmount > 8 * 1024 * 1024) {
              ws.terminate();
              return { kind: "unavailable" };
            }
            ws.send(json);
            return { kind: "sent", bytes };
          },
          close: () => ws.close(),
        });
        lan.sockets.add(ws);
        send(ws, {
          type: "auth_ack",
          device_sid: ticket.sid,
          terminal_sid: randomUUID(),
          pair_status: "matched",
        });
        receiver.ready();
      } else if (message?.type === "pair_status_query") {
        send(ws, { type: "pair_status_ack", pair_status: "matched" });
      } else if (message?.type === "data") {
        receiver.receive(message.payload);
      } else {
        send(ws, { type: "error", code: "WRONG_PARAM" });
        ws.close();
      }
    });
  }

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = URL.parse(req.url ?? "/", localUrl.origin);
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
      if (isLan && side === "terminal") {
        acceptLanSocket(ws, device, ticket);
        return;
      }
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
          remoteTransport?.detach(ticket.sid);
          if (device.lan) {
            for (const terminal of device.lan.sockets) terminal.close();
            device.lan.sockets.clear();
            device.lan = undefined;
          }
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
  }

  // 分开监听私网和回环，外部连接即使伪造 Host 也无法进入桌面注册接口。
  const listeners = (isLan ? [LOOPBACK, publicUrl.hostname] : [LOOPBACK]).map((host) => {
    const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, (req, res) => {
      void serve(req, res).catch(() => {
        if (res.headersSent) res.destroy();
        else reply(res, 400);
      });
    });
    // 修复原因：为 http.Server 挂载持久 error 监听，避免网络切换或网卡断开触发未捕获异常导致主进程崩溃。
    server.on("error", () => {});
    server.on("upgrade", upgrade);
    return { host, server };
  });

  return {
    login,
    get origin() {
      return localUrl.origin;
    },
    get remoteUrl() {
      return new URL("/remote/v4", publicUrl).href;
    },
    get relayWsUrl() {
      return `ws://${localUrl.host}${WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH}`;
    },
    storage: {
      load: async () => registered,
      save: async (device: WebRemoteControlRegisteredDevice) => {
        registered = device;
      },
      clearLegacy: async () => {},
    },
    async start() {
      started ??= (async () => {
        if (!remoteTransport || publicUrl.origin !== localUrl.origin)
          await stat(resolve(root, "index.html"));
        await remoteTransport?.start();
        for (const { host, server } of listeners) {
          server.listen(port, host);
          await once(server, "listening");
          if (nativeOnly && port === 0) {
            const address = server.address();
            if (!address || typeof address === "string") throw new Error("Missing gateway address");
            publicUrl.port = localUrl.port = String(address.port);
          }
        }
      })().catch((error: unknown) => {
        remoteTransport?.dispose();
        for (const { server } of listeners) server.close();
        started = undefined;
        throw error;
      });
      await started;
    },
    pairingUrl(sid: string, baseUrl: string) {
      const device = devices.get(sid);
      if (!device?.device || !baseUrl) return "";
      if (!device.pairing || device.pairing.expiresAt <= Date.now()) {
        device.pairing = {
          value: randomBytes(32).toString("base64url"),
          expiresAt: isLan ? Number.POSITIVE_INFINITY : Date.now() + PAIRING_TTL,
        };
      }
      const url = new URL(baseUrl);
      url.searchParams.set(
        LING_MOBILE_PAIRING.queryKey,
        isLan ? LING_MOBILE_PAIRING.lanQueryValue : "1",
      );
      url.hash = device.pairing.value;
      return url.href;
    },
    nativeOnly,
    nativePairingUrl: remoteTransport
      ? (sid: string, url: string) => remoteTransport.link(sid, url)
      : undefined,
    acceptLanTerminal:
      isLan || remoteTransport
        ? (sid: string, accept: AcceptWebRemoteControlLanTerminal) => {
            const device = devices.get(sid);
            if (device) remoteTransport?.attach(sid, accept);
            if (device && isLan) device.lan ??= { accept, sockets: new Set() };
          }
        : undefined,
    revoke(sid: string) {
      remoteTransport?.detach(sid);
      revoke(sid);
    },
    dispose() {
      remoteTransport?.dispose();
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      for (const { server } of listeners) server.close();
    },
  };
}
