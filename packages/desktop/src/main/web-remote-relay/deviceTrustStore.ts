import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { bytesToHex, hexToBytes, x25519PublicKey } from "@zcode/shared/web-remote-relay";

export interface TrustedRemotePeer {
  readonly id: string;
  readonly name: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number;
}

interface PersistedTrustState {
  hostKeyHex: string;
  peers: Record<string, TrustedRemotePeer>;
}

/**
 * 桌面端远程控制独立设备信任库。
 * 刻意不存进对外暴露 RPC 的 ServiceChannels.Credential，防止手机端通过 Credential 通道读取宿主私钥或篡改白名单。
 */
export class DeviceTrustStore {
  private statePromise: Promise<PersistedTrustState> | undefined;
  private writeChain = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private loadState(): Promise<PersistedTrustState> {
    this.statePromise ??= (async (): Promise<PersistedTrustState> => {
      try {
        const raw = await readFile(this.filePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<PersistedTrustState>;
        if (
          typeof parsed.hostKeyHex === "string" &&
          /^[0-9a-f]{64}$/.test(parsed.hostKeyHex) &&
          parsed.peers &&
          typeof parsed.peers === "object"
        ) {
          return { hostKeyHex: parsed.hostKeyHex, peers: parsed.peers };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
          throw error;
        }
      }
      const initial: PersistedTrustState = {
        hostKeyHex: randomBytes(32).toString("hex"),
        peers: {},
      };
      await this.persist(initial);
      return initial;
    })().catch((error) => {
      this.statePromise = undefined;
      throw error;
    });
    return this.statePromise;
  }

  private async persist(next: PersistedTrustState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(temp, this.filePath);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  private mutate(change: (state: PersistedTrustState) => void): Promise<void> {
    const op = this.writeChain.then(async () => {
      const current = await this.loadState();
      const next = structuredClone(current);
      change(next);
      await this.persist(next);
      current.hostKeyHex = next.hostKeyHex;
      current.peers = next.peers;
    });
    this.writeChain = op.catch(() => {});
    return op;
  }

  async getHostKeyPair(): Promise<{ privateKey: Uint8Array; publicKeyHex: string }> {
    const state = await this.loadState();
    const privateKey = hexToBytes(state.hostKeyHex);
    return { privateKey, publicKeyHex: bytesToHex(x25519PublicKey(privateKey)) };
  }

  async isTrusted(peerId: string): Promise<boolean> {
    const state = await this.loadState();
    return Boolean(state.peers[peerId]);
  }

  async trustPeer(peerId: string, name: string): Promise<void> {
    const now = Date.now();
    await this.mutate((state) => {
      const existing = state.peers[peerId];
      state.peers[peerId] = {
        id: peerId,
        name: name.trim() || existing?.name || "LING Mobile",
        pairedAt: existing?.pairedAt ?? now,
        lastSeenAt: now,
      };
    });
  }

  async touchPeer(peerId: string): Promise<void> {
    const now = Date.now();
    await this.mutate((state) => {
      const existing = state.peers[peerId];
      if (existing) {
        state.peers[peerId] = { ...existing, lastSeenAt: now };
      }
    });
  }

  async listPeers(): Promise<TrustedRemotePeer[]> {
    const state = await this.loadState();
    return Object.values(state.peers).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  async revokePeer(peerId: string): Promise<void> {
    await this.mutate((state) => {
      delete state.peers[peerId];
    });
  }

  async revokeAllPeers(): Promise<void> {
    await this.mutate((state) => {
      state.peers = {};
    });
  }
}
