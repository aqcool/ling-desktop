import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    await git("update-ref", "refs/remotes/origin/master", "HEAD");
    await git("switch", "-qc", "main");
    await commit("1.2.3");
    await git("update-ref", "refs/remotes/origin/main", "HEAD");
    const output = join(root, "github-output");
    const run = async (tag) => {
      await writeFile(output, "");
      return execute("bash", ["-e", "-c", prepare.run], {
        cwd: root,
        env: {
          ...env,
          TAG: tag,
          RELEASE_BRANCH: prepare.env.RELEASE_BRANCH,
          // 模拟仓库默认分支仍是旧 master；发布不能受这个值影响。
          DEFAULT_BRANCH: "master",
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

test("默认分支仍为 master 时，从 main 的附注 tag 解析不可变发布版本", async () => {
  expect(
    workflow.jobs.prepare.steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with
      .ref,
  ).toBe("main");
  await withRepository(async ({ git, run, output }) => {
    await git("tag", "-a", "ling-v1.2.3", "-m", "Release 1.2.3");
    const revision = (await git("rev-parse", "HEAD")).stdout.trim();
    await run("ling-v1.2.3");
    expect(await readFile(output, "utf8")).toBe(
      `tag=ling-v1.2.3\nversion=1.2.3\nrevision=${revision}\nauto_update=0\n`,
    );
  });
});

test.each(["unmerged", "lightweight", "version-mismatch"])(
  "拒绝不满足 main 发布合同的 tag：%s",
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
