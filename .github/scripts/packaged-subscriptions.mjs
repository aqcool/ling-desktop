import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const subscriptionIds = ["claude-subscription", "chatgpt-subscription", "grok-subscription"];
const templatesOf = (release) => release.config.providerConfigRules.templateRules;

/** 使用包内实际程序和配置验证覆盖后的恢复；临时目录不接触用户数据。 */
export async function verifyPackagedSubscriptions({ executable, resources }) {
  const configFile = join(resources, "config/provider/zcode-builtin.json");
  const bundled = JSON.parse(await readFile(configFile, "utf8"));
  const expected = templatesOf(bundled).filter((template) =>
    subscriptionIds.includes(template.templateId),
  );
  assert.equal(expected.length, subscriptionIds.length, "Packaged subscription templates missing");
  const root = await mkdtemp(join(tmpdir(), "ling-packaged-subscriptions-"));
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    ZCODE_DATA_BASE_DIR: root,
    ZCODE_BASE_URL: "http://127.0.0.1:9",
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: configFile,
    ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE: "",
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: "",
  };
  const start = async () => {
    const result = execute(executable, [join(resources, "glm/zcode.cjs"), "app-server"], {
      cwd: root,
      env,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    result.child.stdin.end();
    await result;
  };
  try {
    await start();
    const files = (await readdir(root, { recursive: true })).filter((file) =>
      file.endsWith("zcode-builtin.json"),
    );
    assert.equal(files.length, 1, "Packaged agent must materialize one Active release");
    const activeFile = join(root, files[0]);
    const upstream = structuredClone(bundled);
    upstream.revision += 2;
    upstream.config.providerConfigRules.templateRules = templatesOf(upstream).filter(
      (template) => !subscriptionIds.includes(template.templateId),
    );
    // 复现生产 revision 48 缺少订阅模板的情况，不把本机缓存修好当作包已修好。
    await writeFile(activeFile, JSON.stringify(upstream));
    await start();
    const restored = JSON.parse(await readFile(activeFile, "utf8"));
    assert.equal(restored.revision, upstream.revision, "Upstream updates must remain enabled");
    for (const template of expected) {
      assert.deepEqual(
        templatesOf(restored).find((candidate) => candidate.templateId === template.templateId),
        template,
        `Packaged agent lost ${template.templateId} after upstream update`,
      );
    }
    for (const template of templatesOf(upstream)) {
      assert.deepEqual(
        templatesOf(restored).find((candidate) => candidate.templateId === template.templateId),
        template,
        "Ordinary upstream templates must remain unchanged",
      );
    }
    assert.deepEqual(restored.config.modelConfigRules, upstream.config.modelConfigRules);
    const beforeRestart = await readFile(activeFile, "utf8");
    await start();
    assert.equal(await readFile(activeFile, "utf8"), beforeRestart, "Restart must be idempotent");
    return "passed";
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
