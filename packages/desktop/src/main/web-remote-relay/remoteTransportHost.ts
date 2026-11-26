import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import { WebSocket, WebSocketServer } from "ws";
import {
  LingE2eeSession,
  acceptDesktopHello,
  parseWebRemoteControlRelayV2OutgoingMessage,
  type LingV2BoxMessage,
  type LingV2HelloMessage,
} from "@zcode/shared/web-remote-relay";
import type { AcceptWebRemoteControlLanTerminal } from "./contract.js";
import type { DeviceTrustStore, TrustedRemotePeer } from "./deviceTrustStore.js";

const MAX_PLAINTEXT_BYTES = 1_048_576;
const MAX_QUEUED_BYTES = 8 * MAX_PLAINTEXT_BYTES;
const MAX_CONNECTIONS = 32;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const INVITE_TTL_MS = 5 * 60 * 1000;
const RELAY_RECONNECT_BASE_MS = 1_500;
const RELAY_RECONNECT_MAX_MS = 30_000;

interface VirtualChannel {
  sendText(raw: string): boolean;
  close(): void;
}

interface ActiveSession {
  peerId?: string;
  e2ee?: LingE2eeSession;
  receiver?: ReturnType<AcceptWebRemoteControlLanTerminal>;
  channel: VirtualChannel;
  deadline?: ReturnType<typeof setTimeout>;
  closed: boolean;
}

interface RelayEnvelope {
  r: "open" | "msg" | "close";
  c: string;
  d?: string;
}

function isPrivateIpv4(address: string | undefined): boolean {
  if (!address || !isIPv4(address)) return false;
  const [a, b = 0] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function listPrivateIpv4Addresses(): string[] {
  const result: string[] = [];
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) {
        result.push(entry.address);
      }
    }
  }
  return [...new Set(result)].slice(0, 8);
}

function normalizeRelayUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const isLocalWs =
      url.protocol === "ws:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "wss:" && !isLocalWs) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * LING v2 多路径端到端加密远程传输宿主（替换 IrohMobileHost）。
 * - 同时监听本地局域网 WebSocket（/v2）与可选公网无状态 Go Relay 出站 WebSocket；
 * - 无论 LAN 还是 Relay，均执行相同的 X25519 + ChaCha20-Poly1305 E2EE 握手与密文帧收发；
 * - 独立设备信任库与按设备吊销，彻底脱离通用 CredentialService。
 */
export class RemoteTransportHost {
  private hostKey: { privateKey: Uint8Array; publicKeyHex: string } | undefined;
  private lanServer: Server | undefined;
  private lanWss: WebSocketServer | undefined;
  private lanPort = 0;
  private relaySocket: WebSocket | undefined;
  private relayTimer: ReturnType<typeof setTimeout> | undefined;
  private relayRetryMs = RELAY_RECONNECT_BASE_MS;
  private readonly relayUrl: string | null;
  private starting: Promise<void> | undefined;
  private generation = 0;
  private window: { sid: string; accept: AcceptWebRemoteControlLanTerminal } | undefined;
  private invite: { sid: string; code: string; expires: number } | undefined;
  private readonly sessions = new Set<ActiveSession>();
  private readonly relaySessions = new Map<string, ActiveSession>();

  constructor(
    private readonly mid: string,
    private readonly trustStore: DeviceTrustStore,
    relayUrl?: string,
  ) {
    this.relayUrl = normalizeRelayUrl(relayUrl);
  }

  start(): Promise<void> {
    if (this.lanServer && this.hostKey) return Promise.resolve();
    const generation = this.generation;
    this.starting ??= this.boot(generation).catch((error: unknown) => {
      if (generation === this.generation) this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  private async boot(generation: number): Promise<void> {
    const keyPair = await this.trustStore.getHostKeyPair();
    if (generation !== this.generation) return;
    this.hostKey = keyPair;

    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PLAINTEXT_BYTES * 2 });
    const server = createServer((_req, res) => {
      res.writeHead(404).end();
    });
    // 持久挂载 error 监听，防止 Wi-Fi 断开或休眠唤醒导致未捕获异常崩溃主进程。
    server.on("error", () => {});
    server.on("upgrade", (req, socket, head) => {
      const pathname = (() => {
        try {
          return new URL(req.url || "/", "http://localhost").pathname;
        } catch {
          return "";
        }
      })();
      if (pathname !== "/v2" || !this.window || this.sessions.size >= MAX_CONNECTIONS) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        this.acceptLanSocket(ws);
      });
    });

    server.listen(0, "0.0.0.0");
    await once(server, "listening");
    if (generation !== this.generation) {
      wss.close();
      server.close();
      return;
    }
    const address = server.address();
    if (!address || typeof address === "string") {
      wss.close();
      server.close();
      throw new Error("Missing remote transport LAN address");
    }
    this.lanServer = server;
    this.lanWss = wss;
    this.lanPort = address.port;

    if (this.relayUrl) {
      this.connectRelay(generation);
    }
  }

  private connectRelay(generation: number): void {
    if (!this.relayUrl || !this.hostKey || generation !== this.generation) return;
    if (this.relayTimer) {
      clearTimeout(this.relayTimer);
      this.relayTimer = undefined;
    }
    const endpoint = new URL(this.relayUrl);
    endpoint.searchParams.set("role", "desktop");
    endpoint.searchParams.set("desktop", this.hostKey.publicKeyHex);

    const ws = new WebSocket(endpoint.toString(), { maxPayload: MAX_PLAINTEXT_BYTES * 2 });
    this.relaySocket = ws;

    ws.on("open", () => {
      if (ws !== this.relaySocket || generation !== this.generation) {
        ws.close();
        return;
      }
      this.relayRetryMs = RELAY_RECONNECT_BASE_MS;
    });

    ws.on("message", (data) => {
      if (ws !== this.relaySocket || generation !== this.generation) return;
      let env: RelayEnvelope;
      try {
        env = JSON.parse(String(data)) as RelayEnvelope;
      } catch {
        return;
      }
      if (!env || typeof env.c !== "string" || !env.c) return;
      if (env.r === "open") {
        if (!this.window || this.sessions.size >= MAX_CONNECTIONS) {
          this.sendRelayEnvelope(ws, { r: "close", c: env.c });
          return;
        }
        const channel: VirtualChannel = {
          sendText: (raw) => this.sendRelayEnvelope(ws, { r: "msg", c: env.c, d: raw }),
          close: () => {
            this.relaySessions.delete(env.c);
            this.sendRelayEnvelope(ws, { r: "close", c: env.c });
          },
        };
        const session = this.createSession(channel);
        this.relaySessions.set(env.c, session);
        return;
      }
      const session = this.relaySessions.get(env.c);
      if (!session) return;
      if (env.r === "close") {
        this.relaySessions.delete(env.c);
        this.closeSession(session);
        return;
      }
      if (env.r === "msg" && typeof env.d === "string") {
        void this.handleIncomingText(session, env.d);
      }
    });

    const onDisconnect = () => {
      if (ws !== this.relaySocket) return;
      this.relaySocket = undefined;
      for (const session of this.relaySessions.values()) {
        this.closeSession(session);
      }
      this.relaySessions.clear();
      if (generation !== this.generation) return;
      const delay = this.relayRetryMs;
      this.relayRetryMs = Math.min(this.relayRetryMs * 2, RELAY_RECONNECT_MAX_MS);
      this.relayTimer = setTimeout(() => this.connectRelay(generation), delay);
    };
    ws.on("close", onDisconnect);
    ws.on("error", onDisconnect);
  }

  private sendRelayEnvelope(ws: WebSocket, env: RelayEnvelope): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (ws.bufferedAmount > MAX_QUEUED_BYTES) {
      ws.terminate();
      return false;
    }
    ws.send(JSON.stringify(env));
    return true;
  }

  private acceptLanSocket(ws: WebSocket): void {
    const channel: VirtualChannel = {
      sendText: (raw) => {
        if (ws.readyState !== WebSocket.OPEN) return false;
        if (ws.bufferedAmount > MAX_QUEUED_BYTES) {
          ws.terminate();
          return false;
        }
        ws.send(raw);
        return true;
      },
      close: () => {
        ws.close();
      },
    };
    const session = this.createSession(channel);
    ws.on("message", (data) => {
      void this.handleIncomingText(session, String(data));
    });
    ws.on("close", () => this.closeSession(session));
    ws.on("error", () => this.closeSession(session));
  }

  private createSession(channel: VirtualChannel): ActiveSession {
    const session: ActiveSession = { channel, closed: false };
    this.sessions.add(session);
    session.deadline = setTimeout(() => this.closeSession(session), HANDSHAKE_TIMEOUT_MS);
    return session;
  }

  private closeSession(session: ActiveSession): void {
    if (session.closed) return;
    session.closed = true;
    if (session.deadline) {
      clearTimeout(session.deadline);
      session.deadline = undefined;
    }
    this.sessions.delete(session);
    session.receiver?.close();
    session.receiver = undefined;
    session.channel.close();
  }

  private sendEncrypted(session: ActiveSession, value: unknown) {
    if (session.closed || !session.e2ee) return { kind: "unavailable" } as const;
    const raw = JSON.stringify(value);
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes > MAX_PLAINTEXT_BYTES) {
      return { kind: "oversize", bytes, maxBytes: MAX_PLAINTEXT_BYTES } as const;
    }
    try {
      const box = session.e2ee.encrypt(raw);
      if (!session.channel.sendText(JSON.stringify(box))) {
        this.closeSession(session);
        return { kind: "unavailable" } as const;
      }
      return { kind: "sent", bytes } as const;
    } catch {
      this.closeSession(session);
      return { kind: "unavailable" } as const;
    }
  }

  private async handleIncomingText(session: ActiveSession, raw: string): Promise<void> {
    if (session.closed) return;
    const owner = this.window;
    const hostKey = this.hostKey;
    if (!owner || !hostKey) {
      this.closeSession(session);
      return;
    }

    let wire: unknown;
    try {
      wire = JSON.parse(raw);
    } catch {
      this.closeSession(session);
      return;
    }
    if (!wire || typeof wire !== "object") {
      this.closeSession(session);
      return;
    }

    // 1. 尚未完成 E2EE 握手：必须先收到合法的 hello
    if (!session.e2ee) {
      const hello = wire as LingV2HelloMessage;
      let accepted: ReturnType<typeof acceptDesktopHello>;
      try {
        accepted = acceptDesktopHello({
          desktopStaticPriv: hostKey.privateKey,
          desktopEphPriv: randomBytes(32),
          expectedMid: this.mid,
          hello,
        });
      } catch {
        session.channel.sendText(JSON.stringify({ t: "err", code: "AUTH_FAILED" }));
        this.closeSession(session);
        return;
      }

      const trusted = await this.trustStore.isTrusted(accepted.peerPubHex);
      if (session.closed || this.window !== owner) {
        this.closeSession(session);
        return;
      }
      if (!trusted) {
        const invite = this.invite;
        const candidate = typeof hello.code === "string" ? Buffer.from(hello.code) : Buffer.alloc(0);
        const expected = invite ? Buffer.from(invite.code) : Buffer.alloc(0);
        if (
          !invite ||
          invite.sid !== owner.sid ||
          invite.expires <= Date.now() ||
          candidate.length !== expected.length ||
          !timingSafeEqual(candidate, expected)
        ) {
          session.channel.sendText(JSON.stringify({ t: "err", code: "AUTH_FAILED" }));
          this.closeSession(session);
          return;
        }
        // 一次性配对码立即作废并持久化该手机公钥到独立信任库。
        this.invite = undefined;
        await this.trustStore.trustPeer(accepted.peerPubHex, hello.name ?? "LING Mobile");
      } else {
        void this.trustStore.touchPeer(accepted.peerPubHex);
      }

      if (session.closed || this.window !== owner) {
        this.closeSession(session);
        return;
      }
      session.peerId = accepted.peerPubHex;
      session.e2ee = accepted.session;
      if (session.deadline) {
        clearTimeout(session.deadline);
        session.deadline = undefined;
      }
      if (!session.channel.sendText(JSON.stringify(accepted.welcome))) {
        this.closeSession(session);
        return;
      }
      return;
    }

    // 2. 已完成 E2EE 握手：仅接受合法加密盒 { t: "box", n, c }
    let plainText: string;
    try {
      plainText = session.e2ee.decrypt(wire as LingV2BoxMessage);
    } catch {
      this.closeSession(session);
      return;
    }

    let message: ReturnType<typeof parseWebRemoteControlRelayV2OutgoingMessage>;
    try {
      message = parseWebRemoteControlRelayV2OutgoingMessage(JSON.parse(plainText));
    } catch {
      this.closeSession(session);
      return;
    }
    if (!message) {
      this.closeSession(session);
      return;
    }

    if (!session.receiver) {
      if (message.type !== "auth_init" || message.device_sid !== this.mid) {
        this.sendEncrypted(session, { type: "error", code: "AUTH_FAILED" });
        this.closeSession(session);
        return;
      }
      session.receiver = owner.accept({
        sendPayloadResult: (payload) => this.sendEncrypted(session, { type: "data", payload }),
        close: () => this.closeSession(session),
      });
      this.sendEncrypted(session, {
        type: "auth_ack",
        device_sid: this.mid,
        pair_status: "matched",
      });
      session.receiver.ready();
      return;
    }

    if (message.type === "pair_status_query") {
      this.sendEncrypted(session, { type: "pair_status_ack", pair_status: "matched" });
    } else if (message.type === "data") {
      session.receiver.receive(message.payload);
    } else {
      this.closeSession(session);
    }
  }

  attach(sid: string, accept: AcceptWebRemoteControlLanTerminal): void {
    if (this.window?.sid === sid) return;
    if (this.window) this.detach(this.window.sid);
    this.window = { sid, accept };
  }

  link(sid: string, base: string): string {
    if (!this.hostKey || !this.lanPort) return "";
    if (!this.invite || this.invite.sid !== sid || this.invite.expires <= Date.now()) {
      this.invite = {
        sid,
        code: randomBytes(32).toString("base64url"),
        expires: Date.now() + INVITE_TTL_MS,
      };
    }
    let name = "工作设备";
    if (base) {
      try {
        name = new URL(base).searchParams.get("name") || name;
      } catch {
        // 忽略非法 base URL，避免状态轮询抛出 Invalid URL。
      }
    }
    const url = new URL("ling-mobile://connect/v2");
    url.searchParams.set("mid", this.mid);
    url.searchParams.set("pk", this.hostKey.publicKeyHex);
    url.searchParams.set("name", name);
    for (const ip of listPrivateIpv4Addresses()) {
      url.searchParams.append("lan", `${ip}:${this.lanPort}`);
    }
    if (this.relayUrl) {
      url.searchParams.set("relay", this.relayUrl);
    }
    url.hash = this.invite.code;
    return url.href;
  }

  listPeers(): Promise<TrustedRemotePeer[]> {
    return this.trustStore.listPeers();
  }

  async revokePeer(peerId: string): Promise<void> {
    await this.trustStore.revokePeer(peerId);
    for (const session of Array.from(this.sessions)) {
      if (session.peerId === peerId) this.closeSession(session);
    }
  }

  async revokeAllPeers(): Promise<void> {
    await this.trustStore.revokeAllPeers();
    for (const session of Array.from(this.sessions)) {
      this.closeSession(session);
    }
  }

  detach(sid: string): void {
    if (this.invite?.sid === sid) this.invite = undefined;
    if (this.window?.sid !== sid) return;
    this.window = undefined;
    for (const session of Array.from(this.sessions)) {
      this.closeSession(session);
    }
  }

  dispose(): void {
    this.generation += 1;
    if (this.relayTimer) {
      clearTimeout(this.relayTimer);
      this.relayTimer = undefined;
    }
    if (this.window) this.detach(this.window.sid);
    for (const session of Array.from(this.sessions)) {
      this.closeSession(session);
    }
    this.relaySessions.clear();
    const relay = this.relaySocket;
    this.relaySocket = undefined;
    relay?.terminate();
    this.lanWss?.close();
    this.lanWss = undefined;
    this.lanServer?.close();
    this.lanServer = undefined;
    this.lanPort = 0;
    this.starting = undefined;
  }
}
