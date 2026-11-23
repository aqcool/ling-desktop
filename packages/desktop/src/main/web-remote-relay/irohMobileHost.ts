import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Connection, Endpoint, RecvStream } from "@number0/iroh";
import type { AcceptWebRemoteControlLanTerminal } from "./contract.js";

const ALPN = Array.from(Buffer.from("ling/zcode/1"));
const LIMIT = 1024 * 1024;

interface Credentials {
  load(key: string): Promise<string | null | undefined>;
  save(key: string, value: string): Promise<void>;
}

async function readFrame(stream: RecvStream) {
  const length = Buffer.from(await stream.readExact(4)).readUInt32BE();
  if (!length || length > LIMIT) throw new Error("Invalid frame size");
  const value: unknown = JSON.parse(Buffer.from(await stream.readExact(length)).toString("utf8"));
  if (!value || typeof value !== "object") throw new Error("Invalid frame");
  return value as Record<string, unknown>;
}

/** One active desktop window. MID selects the machine, the QUIC key authenticates each peer. */
export class IrohMobileHost {
  private endpoint?: Endpoint;
  private window?: { sid: string; accept: AcceptWebRemoteControlLanTerminal };
  private invite?: { sid: string; code: string; expires: number };
  private connections = new Set<Connection>();
  private starting?: Promise<void>;
  private generation = 0;

  constructor(
    private readonly mid: string,
    private readonly credentials: Credentials,
  ) {}

  start() {
    return (this.starting ??= this.bind(this.generation).catch((error: unknown) => {
      this.starting = undefined;
      throw error;
    }));
  }

  private async bind(generation: number) {
    const { Endpoint, SecretKey } = await import("@number0/iroh");
    const keyName = "ling:iroh:host-key:v1";
    let key = await this.credentials.load(keyName);
    if (!key) {
      key = Buffer.from(SecretKey.generate().toBytes()).toString("hex");
      await this.credentials.save(keyName, key);
    }
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid stored iroh identity");
    const endpoint = await Endpoint.bind({
      secretKey: [...Buffer.from(key, "hex")],
      alpns: [ALPN],
    });
    if (generation !== this.generation) {
      await endpoint.close();
      return;
    }
    this.endpoint = endpoint;
    void this.listen(endpoint).catch(() => {
      if (this.endpoint === endpoint) this.dispose();
    });
  }

  private async listen(endpoint: Endpoint) {
    while (this.endpoint === endpoint) {
      const incoming = await endpoint.acceptNext();
      if (!incoming) return;
      const owner = this.window;
      if (!owner || this.connections.size >= 32) {
        await incoming.refuse();
        continue;
      }
      void (async () => {
        const conn = await (await incoming.accept()).connect();
        if (this.window !== owner || this.connections.size >= 32) {
          conn.close(0n, []);
          return;
        }
        this.connections.add(conn);
        try {
          await this.serve(conn, owner);
        } finally {
          this.connections.delete(conn);
          conn.close(0n, []);
        }
      })().catch(() => {});
    }
  }

  private async serve(conn: Connection, owner: NonNullable<IrohMobileHost["window"]>) {
    const deadline = setTimeout(() => conn.close(1n, []), 15000);
    let receiver: ReturnType<AcceptWebRemoteControlLanTerminal> | undefined;
    try {
      const { send, recv } = await conn.acceptBi();
      let queued = 0;
      let tail = Promise.resolve();
      const write = (value: unknown) => {
        const bytes = Buffer.from(JSON.stringify(value));
        if (bytes.length > LIMIT)
          return { kind: "oversize", bytes: bytes.length, maxBytes: LIMIT } as const;
        if (queued + bytes.length > 8 * LIMIT) {
          conn.close(1n, []);
          return { kind: "unavailable" } as const;
        }
        queued += bytes.length;
        const frame = Buffer.allocUnsafe(bytes.length + 4);
        frame.writeUInt32BE(bytes.length);
        bytes.copy(frame, 4);
        tail = tail
          .then(() => send.writeAll([...frame]))
          .catch(() => conn.close(1n, []))
          .finally(() => {
            queued -= bytes.length;
          });
        return { kind: "sent", bytes: bytes.length } as const;
      };
      const hello = await readFrame(recv);
      const peer = conn.remoteId().toString();
      const grant = "ling:iroh:peer:" + peer;
      const trusted = await this.credentials.load(grant);
      if (this.window !== owner || hello.type !== "auth_init" || hello.device_sid !== this.mid)
        return;
      if (trusted !== "allowed") {
        const code = typeof hello.code === "string" ? Buffer.from(hello.code) : Buffer.alloc(0);
        const invite = this.invite;
        if (
          !invite ||
          invite.sid !== owner.sid ||
          invite.expires <= Date.now() ||
          code.length !== invite.code.length ||
          !timingSafeEqual(code, Buffer.from(invite.code))
        ) {
          write({ type: "error", code: "AUTH_FAILED" });
          await tail;
          await send.finish();
          await send.stopped();
          return;
        }
        this.invite = undefined;
        await this.credentials.save(grant, "allowed");
      }
      if (this.window !== owner || !this.connections.has(conn)) return;
      clearTimeout(deadline);
      receiver = owner.accept({
        sendPayloadResult: (payload) => write({ type: "data", payload }),
        close: () => conn.close(0n, []),
      });
      write({ type: "auth_ack", device_sid: this.mid, pair_status: "matched" });
      receiver.ready();
      while (this.window === owner) {
        const message = await readFrame(recv);
        if (message.type === "pair_status_query")
          write({ type: "pair_status_ack", pair_status: "matched" });
        else if (message.type === "data") receiver.receive(message.payload);
        else break;
      }
    } finally {
      clearTimeout(deadline);
      receiver?.close();
    }
  }

  attach(sid: string, accept: AcceptWebRemoteControlLanTerminal) {
    if (this.window?.sid === sid) return;
    if (this.window) this.detach(this.window.sid);
    this.window = { sid, accept };
  }
  link(sid: string, base: string) {
    const endpoint = this.endpoint;
    if (!endpoint) return "";
    if (!this.invite || this.invite.sid !== sid || this.invite.expires <= Date.now())
      this.invite = {
        sid,
        code: randomBytes(32).toString("base64url"),
        expires: Date.now() + 120000,
      };
    const url = new URL("ling-mobile://iroh/connect");
    url.searchParams.set("mid", this.mid);
    url.searchParams.set("endpoint", endpoint.id().toString());
    url.searchParams.set("name", new URL(base).searchParams.get("name") || "工作设备");
    const addresses = endpoint.addr();
    // 蜂窝网络无法使用私网 IP，带上已连接的中继，避免首次连接依赖 TXT 发现。
    const relay = addresses.relayUrl();
    if (relay) url.searchParams.set("relay", relay);
    for (const address of addresses.directAddresses().slice(0, 8))
      url.searchParams.append("addr", address);
    url.hash = this.invite.code;
    return url.href;
  }
  detach(sid: string) {
    if (this.invite?.sid === sid) this.invite = undefined;
    if (this.window?.sid !== sid) return;
    this.window = undefined;
    for (const conn of this.connections) conn.close(0n, []);
    this.connections.clear();
  }
  dispose() {
    this.generation++;
    if (this.window) this.detach(this.window.sid);
    const endpoint = this.endpoint;
    this.endpoint = undefined;
    this.starting = undefined;
    return endpoint?.close().catch(() => {});
  }
}
