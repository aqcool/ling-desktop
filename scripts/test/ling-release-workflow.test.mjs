import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { parse } from "yaml";

const execute = promisify(execFile);
const workflow = parse(
  await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"),
);
const prepare = workflow.jobs.prepare.steps.find((step) => step.id === "release");

test.each(["arm64", "x64"])("无证书的 macOS %s 构建不向打包工具传递空证书路径", async (arch) => {
  const root = await mkdtemp(join(tmpdir(), "ling-manual-signing-env-"));
  const bin = join(root, "bin");
  const output = join(root, "probe");
  const build = workflow.jobs.build.steps.find(
    (step) => step.name === "Build and verify packaged dependencies",
  );
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, "corepack"),
      `#!/bin/bash
set -eu
test -z "\${CSC_LINK+x}" || exit 31
test -z "\${CSC_KEY_PASSWORD+x}" || exit 32
printf '%s\\n%s\\n' "$*" "\${CUSTOM_DMGBUILD_PATH:-}" > "$PROBE_OUTPUT"
`,
      { mode: 0o755 },
    );
    await execute("bash", ["-e", "-c", build.run], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TARGET_OS: "mac",
        TARGET_ARCH: arch,
        ZCODE_AUTO_UPDATE: "0",
        CSC_LINK: "",
        CSC_KEY_PASSWORD: "",
        CUSTOM_DMGBUILD_PATH: "",
        GITHUB_WORKSPACE: root,
        PROBE_OUTPUT: output,
      },
    });
    const [command, dmgBuilder] = (await readFile(output, "utf8")).split("\n");
    expect(command).toBe(`pnpm --filter @zcode/desktop run bundle --os mac --arch ${arch}`);
    expect(dmgBuilder).toBe(
      arch === "x64" ? join(root, "release-tools/.github/scripts/build-unsigned-intel-dmg.sh") : "",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function withRepository(check) {
  const root = await mkdtemp(join(tmpdir(), "ling-release-source-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Release Test",
    GIT_AUTHOR_EMAIL: "release-test@example.invalid",
    GIT_COMMITTER_NAME: "Release Test",
    GIT_COMMITTER_EMAIL: "release-test@example.invalid",
  };
  const git = (...args) => execute("git", args, { cwd: root, env });
  const commit = async (version) => {
    await writeFile(join(root, "package.json"), JSON.stringify({ version }));
    await git("add", "package.json");
    await git("-c", "commit.gpgsign=false", "commit", "-qm", version);
  };
  try {
    await git("init", "-q", "-b", "master");
    await commit("1.2.2");
    await commit("1.2.3");
    await git("update-ref", "refs/remotes/origin/master", "HEAD");
    const output = join(root, "github-output");
    const run = async (tag) => {
      await writeFile(output, "");
      return execute("bash", ["-e", "-c", prepare.run], {
        cwd: root,
        env: {
          ...env,
          TAG: tag,
          RELEASE_BRANCH: prepare.env.RELEASE_BRANCH,
          // 发布来源固定为 master，不依赖默认分支名或已删除的 main 引用。
          DEFAULT_BRANCH: "main",
          LING_SIGNED_RELEASES: "0",
          GITHUB_OUTPUT: output,
        },
      });
    };
    await check({ root, git, commit, output, run });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("只有 master 分支时，从附注 tag 解析不可变发布版本", async () => {
  expect(
    workflow.jobs.prepare.steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with
      .ref,
  ).toBe("master");
  await withRepository(async ({ git, run, output }) => {
    expect((await git("branch", "--format=%(refname:short)")).stdout.trim()).toBe("master");
    expect((await git("branch", "-r", "--format=%(refname:short)")).stdout.trim()).toBe(
      "origin/master",
    );
    await git("tag", "-a", "ling-v1.2.3", "-m", "Release 1.2.3");
    const revision = (await git("rev-parse", "HEAD")).stdout.trim();
    await run("ling-v1.2.3");
    expect(await readFile(output, "utf8")).toBe(
      `tag=ling-v1.2.3\nversion=1.2.3\nrevision=${revision}\nauto_update=0\n`,
    );
  });
});

test.each(["unmerged", "lightweight", "version-mismatch"])(
  "拒绝不满足 master 发布合同的 tag：%s",
  async (reason) => {
    await withRepository(async ({ git, commit, run, output }) => {
      if (reason === "unmerged") {
        await git("switch", "-qc", "other");
        await commit("1.2.4");
      }
      const tag = reason === "lightweight" ? "ling-v1.2.3" : "ling-v1.2.4";
      if (reason === "lightweight") await git("tag", tag);
      else await git("tag", "-a", tag, "-m", "Invalid release source");
      await expect(run(tag)).rejects.toThrow();
      expect(await readFile(output, "utf8")).toBe("");
    });
  },
);
