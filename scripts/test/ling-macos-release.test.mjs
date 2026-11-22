import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, vi } from "vitest";
import { verifyMacReleaseSignature } from "../../.github/scripts/macos-release-signature.mjs";

const appPath = "/build/LING.app";
const imagePath = "/build/LING.dmg";
const execute = promisify(execFile);

test.each([false, true])(
  "macOS 发行始终验收构建应用及 DMG 内签名（公证=%s）",
  async (requireNotarization) => {
    const run = vi.fn(async () => {});
    await verifyMacReleaseSignature({ appPath, imagePath, requireNotarization, run });
    const calls = run.mock.calls.map(([command, args]) => [command, args]);
    expect(calls[0]).toEqual(["codesign", ["--verify", "--deep", "--strict", appPath]]);
    const attach = calls.find(([command, args]) => command === "hdiutil" && args[0] === "attach");
    expect(attach[1]).toEqual([
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      expect.any(String),
      imagePath,
    ]);
    const mountPath = attach[1][4];
    expect(calls).toContainEqual([
      "codesign",
      ["--verify", "--deep", "--strict", join(mountPath, "LING.app")],
    ]);
    expect(calls).toContainEqual(["hdiutil", ["detach", mountPath]]);
    await expect(access(mountPath)).rejects.toMatchObject({ code: "ENOENT" });
    const notarizationCalls = calls.filter(([command]) => command === "xcrun");
    expect(notarizationCalls).toEqual(
      requireNotarization
        ? [
            ["xcrun", ["stapler", "validate", appPath]],
            ["xcrun", ["stapler", "validate", imagePath]],
          ]
        : [],
    );
    expect(
      calls.some(([command, args]) => command === "codesign" && args.at(-1) === imagePath),
    ).toBe(requireNotarization);
  },
);

test("镜像内应用签名损坏时拒绝发行，同时卸载和清理挂载点", async () => {
  let mountPath;
  const run = vi.fn(async (command, args) => {
    if (command === "hdiutil" && args[0] === "attach") mountPath = args[4];
    if (command === "codesign" && args.at(-1) !== appPath) throw new Error("invalid resource seal");
  });
  await expect(verifyMacReleaseSignature({ appPath, imagePath, run })).rejects.toThrow(
    "invalid resource seal",
  );
  expect(run).toHaveBeenLastCalledWith("hdiutil", ["detach", mountPath], expect.any(Object));
  await expect(access(mountPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("构建应用签名失败时不挂载镜像", async () => {
  const run = vi.fn(async () => {
    throw new Error("unsigned app");
  });
  await expect(verifyMacReleaseSignature({ appPath, imagePath, run })).rejects.toThrow(
    "unsigned app",
  );
  expect(run).toHaveBeenCalledTimes(1);
});

test("挂载失败时不检查镜像内应用，并清理临时目录", async () => {
  let mountPath;
  const run = vi.fn(async (command, args) => {
    if (command === "hdiutil" && args[0] === "attach") {
      mountPath = args[4];
      throw new Error("attach failed");
    }
  });
  await expect(verifyMacReleaseSignature({ appPath, imagePath, run })).rejects.toThrow(
    "attach failed",
  );
  expect(run).toHaveBeenCalledTimes(2);
  await expect(access(mountPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("卸载失败时保留挂载目录及其内容", async () => {
  let mountPath;
  const run = vi.fn(async (command, args) => {
    if (command === "hdiutil" && args[0] === "attach") {
      mountPath = args[4];
      await writeFile(join(mountPath, "sentinel"), "mounted image");
    }
    if (command === "hdiutil" && args[0] === "detach") throw new Error("detach failed");
  });
  try {
    await expect(verifyMacReleaseSignature({ appPath, imagePath, run })).rejects.toThrow(
      "detach failed",
    );
    expect(await readFile(join(mountPath, "sentinel"), "utf8")).toBe("mounted image");
  } finally {
    if (mountPath) await rm(mountPath, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "darwin")(
  "真实发行入口在关闭自动更新时仍拒绝无效签名，且不生成通过报告",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "ling-qualify-manual-"));
    const target = `mac-${process.arch}`;
    const appDirectory = process.arch === "arm64" ? "mac-arm64" : "mac";
    const dist = join(root, "source/packages/desktop/dist");
    const contents = join(dist, appDirectory, "LING.app/Contents");
    const tools = join(root, "tools");
    try {
      await mkdir(join(contents, "MacOS"), { recursive: true });
      await mkdir(join(contents, "Resources/glm"), { recursive: true });
      await mkdir(tools);
      await symlink(process.execPath, join(contents, "MacOS/LING"));
      await writeFile(join(contents, "Resources/glm/zcode.cjs"), 'console.log("1.2.3");');
      await writeFile(join(dist, `LING-1.2.3-${target}.dmg`), "fixture");
      await writeFile(join(tools, "hdiutil"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      await writeFile(
        join(tools, "codesign"),
        "#!/bin/sh\necho 'invalid resource seal' >&2\nexit 9\n",
        { mode: 0o755 },
      );
      const script = fileURLToPath(
        new URL("../../.github/scripts/qualify-release.mjs", import.meta.url),
      );
      await expect(
        execute(process.execPath, [script], {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${tools}:${process.env.PATH}`,
            TARGET_OS: "mac",
            TARGET_ARCH: process.arch,
            RELEASE_VERSION: "1.2.3",
            RELEASE_REVISION: "fixture",
            ZCODE_AUTO_UPDATE: "0",
          },
        }),
      ).rejects.toMatchObject({ stderr: expect.stringContaining("invalid resource seal") });
      await expect(
        access(join(root, "release-assets", `LING-1.2.3-${target}-report.json`)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        access(join(root, "release-assets", `LING-1.2.3-${target}.dmg`)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
