import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const subscriptionIds = ["claude-subscription", "chatgpt-subscription", "grok-subscription"];
const templatesOf = (release) => release.config.providerConfigRules.templateRules;

/** 通过包内 Agent 进程验收模型目录缓存隔离和订阅模板。 */
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
    assert.match(basename(dirname(activeFile)), /^models-dev-v1-(production|test)$/u);
    const legacy = structuredClone(bundled);
    legacy.revision += 2;
    legacy.config.providerConfigRules.templateRules = templatesOf(legacy).filter(
      (template) => !subscriptionIds.includes(template.templateId),
    );
    const legacyKey = createHash("sha256").update(env.ZCODE_BASE_URL).digest("hex").slice(0, 32);
    const legacyDir = join(dirname(dirname(activeFile)), `endpoint-${legacyKey}`);
    await mkdir(legacyDir, { recursive: true });
    const legacyFile = join(legacyDir, "zcode-builtin.json");
    const legacyContents = JSON.stringify(legacy);
    // 复现旧 ZCode revision 48：缓存版本较高，也不能覆盖新目录。
    await writeFile(legacyFile, legacyContents);
    await start();
    const restored = JSON.parse(await readFile(activeFile, "utf8"));
    assert.equal(restored.revision, bundled.revision, "Old ZCode directory must remain isolated");
    assert.equal(await readFile(legacyFile, "utf8"), legacyContents);
    for (const template of expected) {
      assert.deepEqual(
        templatesOf(restored).find((candidate) => candidate.templateId === template.templateId),
        template,
        `Packaged agent lost ${template.templateId}`,
      );
    }
    const metadata = {
      templateId: "openai",
      modelId: "gpt-release-model-catalog-fixture",
      inheritSubscription: false,
      config: { properties: { contextWindow: 345_000 } },
    };
    restored.config.modelConfigRules.templateModelRules.push(metadata);
    await writeFile(activeFile, JSON.stringify(restored));
    await start();
    const cached = JSON.parse(await readFile(activeFile, "utf8"));
    assert.deepEqual(
      cached.config.modelConfigRules.templateModelRules.find(
        (rule) => rule.modelId === metadata.modelId,
      ),
      metadata,
      "Packaged agent must retain the valid models.dev cache on restart",
    );
    assert.deepEqual(templatesOf(cached), templatesOf(restored));
    return "passed";
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
