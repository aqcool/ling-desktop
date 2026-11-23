// Run from the workspace root with: node --import tsx --test <this file>
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Endpoint, EndpointAddr, EndpointId, SecretKey, RelayMode } from "@number0/iroh";
import { IrohMobileHost } from "../../../../../../src/main/web-remote-relay/irohMobileHost.ts";

test(
  "one-time QR authorizes the QUIC peer across SID and host restarts",
  { timeout: 35000 },
  async () => {
    const data = new Map(),
      mid = randomUUID();
    const credentials = {
      async load(k) {
        return data.get(k);
      },
      async save(k, v) {
        data.set(k, v);
      },
    };
    const host = new IrohMobileHost(mid, credentials);
    const trusted = await Endpoint.bind(
      { secretKey: SecretKey.generate().toBytes() },
      RelayMode.disabled(),
    );
    const stranger = await Endpoint.bind({}, RelayMode.disabled());
    const socket = async (client, link, code) => {
      const url = new URL(link);
      const addr = new EndpointAddr(
        EndpointId.fromString(url.searchParams.get("endpoint")),
        null,
        url.searchParams.getAll("addr"),
      );
      const conn = await client.connect(addr, [...Buffer.from("ling/zcode/1")]);
      const { send, recv } = await conn.openBi();
      async function write(message) {
        const bytes = Buffer.from(JSON.stringify(message)),
          len = Buffer.alloc(4);
        len.writeUInt32BE(bytes.length);
        await send.writeAll([...len, ...bytes]);
      }
      async function read() {
        const n = Buffer.from(await recv.readExact(4)).readUInt32BE();
        return JSON.parse(Buffer.from(await recv.readExact(n)));
      }
      await write({ type: "auth_init", device_sid: mid, code });
      return { conn, write, read };
    };
    const attach = () => {
      const sid = randomUUID();
      host.attach(sid, ({ sendPayloadResult }) => ({
        ready() {},
        close() {},
        receive(payload) {
          sendPayloadResult(payload);
        },
      }));
      return { link: host.link(sid, "https://example.invalid/?name=Desktop"), sid };
    };
    try {
      await host.start();
      const first = attach();
      const code = new URL(first.link).hash.slice(1);
      const a = await socket(trusted, first.link, code);
      assert.equal((await a.read()).pair_status, "matched");
      await a.write({ type: "data", payload: { request: "bootstrap" } });
      assert.deepEqual((await a.read()).payload, { request: "bootstrap" });
      const rejected = await socket(stranger, first.link, code);
      assert.equal((await rejected.read()).code, "AUTH_FAILED");
      host.detach(first.sid);
      await a.conn.closed();
      await host.dispose();
      await host.start();
      const next = attach();
      assert.equal(
        new URL(next.link).searchParams.get("endpoint"),
        new URL(first.link).searchParams.get("endpoint"),
      );
      const b = await socket(trusted, next.link, "");
      assert.equal((await b.read()).pair_status, "matched");
    } finally {
      await host.dispose();
      await Promise.all([trusted.close(), stranger.close()]);
    }
  },
);
