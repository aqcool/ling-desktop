import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { StdioStream } from "@zcode/server/remote";
import { quotePosixShellArg } from "@zcode/server/remote/posixShell.js";
import type { SourceServerFileTransfer } from "@zcode/server/source-server";
import type { ConnectionProfile } from "@zcode/shared";
import { z } from "zod";
import type { SourceServerDirectory } from "../sourceServerDirectory.js";
import { requestSchema, serverArgs, serverId, copyArgs } from "./contract.js";

interface Binding {
  id: string;
  endpoint: string;
}

interface State {
  bindings: Record<string, Binding[]>;
}

function endpoint(profile: ConnectionProfile): string {
  const target = profile.target;
  if (target.kind !== "ssh") throw new Error("Select an SSH connection.");
  return JSON.stringify([profile.profileId, target.host, target.port, target.username]);
}

async function output(stream: NodeJS.ReadableStream): Promise<string> {
  const limit = 32 * 1024;
  let remaining = limit;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
    remaining -= bytes.length;
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return remaining < 0 ? text + "\n[output truncated]" : text;
}

async function collect(stream: StdioStream, signal?: AbortSignal) {
  const closed = new Promise<number>((done) => {
    const subscription = stream.onClose((code) => {
      subscription.dispose();
      done(code);
    });
  });
  const close = () => stream.close?.();
  signal?.addEventListener("abort", close, { once: true });
  try {
    if (signal?.aborted) close();
    stream.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      output(stream.stdout),
      output(stream.stderr),
      closed,
    ]);
    signal?.throwIfAborted();
    return { stdout, stderr, exitCode };
  } finally {
    signal?.removeEventListener("abort", close);
  }
}

export function createServerOpsBridge(
  file: string,
  directory: () => SourceServerDirectory | null,
  getSshFileTransfer: (profile: ConnectionProfile) => SourceServerFileTransfer | undefined,
) {
  const state = readFile(file, "utf8").then(
    (text): State => ({ bindings: (JSON.parse(text) as State).bindings }),
    (error: NodeJS.ErrnoException): State => {
      if (error.code !== "ENOENT") throw error;
      return { bindings: {} };
    },
  );
  let pendingWrite = Promise.resolve();

  function update(change: (current: State) => void) {
    const nextWrite = pendingWrite.then(async () => {
      const current = await state;
      const next = structuredClone(current);
      change(next);
      await mkdir(dirname(file), { recursive: true });
      const temporary = file + ".tmp";
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, file);
      Object.assign(current, next);
    });
    pendingWrite = nextWrite.catch(() => {});
    return nextWrite;
  }

  async function execute(body: z.infer<typeof requestSchema>, signal: AbortSignal) {
    const inventory = directory();
    if (!inventory) throw new Error("Saved SSH connections are unavailable.");
    const profiles = (await inventory.snapshot()).profiles.filter(
      (profile) => profile.transport === "ssh" && profile.lifecycleState !== "retired",
    );
    const current = await state;
    const scope = JSON.stringify(body.sessionId);
    const bindings = current.bindings[scope] ?? [];
    const selected = profiles.filter((profile) =>
      bindings.some(
        (binding) => binding.id === profile.profileId && binding.endpoint === endpoint(profile),
      ),
    );
    const publicProfile = (profile: ConnectionProfile) => ({
      id: profile.profileId,
      name:
        profile.displayName ||
        (profile.target.kind === "ssh"
          ? `${profile.target.username}@${profile.target.host}`
          : profile.profileId),
    });
    const agentProfile = (profile: ConnectionProfile) => {
      const { id, name } = publicProfile(profile);
      return { id: `${name} [${id}]`, name };
    };
    switch (body.action) {
      case "picker_read":
        return {
          profiles: profiles.map(publicProfile),
          serverIds: selected.map((profile) => profile.profileId),
        };
      case "picker_save": {
        const { serverIds } = z.object({ serverIds: z.array(serverId) }).parse(body.args);
        const selection = [...new Set(serverIds)].map((id) => {
          const profile = profiles.find((entry) => entry.profileId === id);
          if (!profile) throw new Error("SSH connection no longer exists.");
          return { id, endpoint: endpoint(profile) };
        });
        await update((next) => {
          if (selection.length) next.bindings[scope] = selection;
          else delete next.bindings[scope];
        });
        return { serverIds: selection.map((binding) => binding.id) };
      }
      case "server_list":
        return { servers: selected.map(agentProfile) };
    }

    const { serverId: id } = serverArgs.parse(body.args);
    const profile = selected.find((entry) => agentProfile(entry).id === id);
    if (!profile) throw new Error("Select this SSH connection in the current conversation first.");
    const identity = endpoint(profile);
    const backend = getSshFileTransfer(profile);
    if (!backend) {
      throw new Error(
        `Connect to ${publicProfile(profile).name} in Settings → Remote Devices, then retry.`,
      );
    }
    const assertSelected = () => {
      signal.throwIfAborted();
      if (!current.bindings[scope]?.some((binding) => binding.endpoint === identity)) {
        throw new Error("The server selection changed.");
      }
    };
    assertSelected();
    if (body.action === "remote_run") {
      const { command } = z
        .object({ command: z.string().trim().min(1).max(16_384) })
        .parse(body.args);
      return {
        server: agentProfile(profile),
        ...(await collect(await backend.exec(command), signal)),
      };
    }
    const args = copyArgs.parse(body.args);
    const workspace = await realpath(body.workspacePath);
    const source = await realpath(resolve(workspace, args.source));
    const within = relative(workspace, source);
    if (
      within === ".." ||
      within.startsWith(`..${sep}`) ||
      isAbsolute(within) ||
      !(await stat(source)).isFile()
    ) {
      throw new Error("Choose a file inside the current workspace.");
    }
    if (
      !posix.isAbsolute(args.destination) ||
      args.destination.endsWith("/") ||
      posix.basename(args.destination) === "." ||
      posix.basename(args.destination) === ".."
    ) {
      throw new Error("Enter an absolute destination file path.");
    }
    if (!backend.exists || !backend.publishUpload)
      throw new Error("SSH file transfer is unavailable.");
    assertSelected();
    if (args.overwrite === "skip" && (await backend.exists(args.destination))) {
      return { server: agentProfile(profile), destination: args.destination, skipped: true };
    }
    const stage = posix.join(posix.dirname(args.destination), `.ling-upload-${randomUUID()}`);
    try {
      assertSelected();
      await backend.upload(source, stage, { signal });
      assertSelected();
      await backend.publishUpload(stage, args.destination, args.overwrite === "replace");
    } catch (error) {
      if (!signal.aborted) {
        const cleanup = await backend
          .exec(`rm -f ${quotePosixShellArg(stage)}`)
          .catch(() => undefined);
        if (cleanup) await collect(cleanup).catch(() => {});
      }
      throw error;
    }
    return { server: agentProfile(profile), destination: args.destination };
  }

  const token = randomBytes(32).toString("hex");
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method !== "POST" || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end(JSON.stringify({ error: "Server operations are unavailable." }));
      return;
    }
    const abort = new AbortController();
    response.once("close", () => abort.abort());
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]);
    try {
      const input = requestSchema.parse(JSON.parse(await output(request)));
      response.end(JSON.stringify(await execute(input, signal)));
    } catch (error) {
      response.statusCode = 400;
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      );
    }
  });

  let ready: Promise<string> | undefined;
  return {
    environment: () => {
      ready ??= new Promise((done, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string")
            return reject(new Error("SSH bridge address unavailable."));
          done(JSON.stringify({ url: `http://127.0.0.1:${address.port}/`, token }));
        });
      });
      return ready;
    },
    dispose: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}
