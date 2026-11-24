import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { verifyPackagedSubscriptions } from "../../.github/scripts/packaged-subscriptions.mjs";

test.each([true, false])("发行检查识别包内程序能否隔离旧 ZCode 目录：%s", async (isolates) => {
  const root = await mkdtemp(join(tmpdir(), "ling-packaged-subscriptions-test-"));
  const resources = join(root, "resources");
  try {
    await mkdir(join(resources, "glm"), { recursive: true });
    await mkdir(join(resources, "config/provider"), { recursive: true });
    const templateRules = [
      { templateId: "openai" },
      { templateId: "claude-subscription" },
      { templateId: "chatgpt-subscription" },
      { templateId: "grok-subscription" },
    ];
    await writeFile(
      join(resources, "config/provider/zcode-builtin.json"),
      JSON.stringify({
        revision: 46,
        config: {
          providerConfigRules: { templateRules },
          modelConfigRules: { templateModelRules: [] },
        },
      }),
    );
    // 小程序只作为发行检查的输入夹具，验证检查会拒绝“能启动但丢入口”的产物。
    await writeFile(
      join(resources, "glm/zcode.cjs"),
      `const fs = require('node:fs');
const path = require('node:path');
const root = process.env.ZCODE_DATA_BASE_DIR;
const dir = path.join(root, ".zcode", "v2", "runtime", "provider", "fixture", "0.1.1");
const file = path.join(dir, "models-dev-v1-production", "zcode-builtin.json");
const legacy = path.join(dir, "endpoint-" + require("node:crypto").createHash("sha256")
  .update(process.env.ZCODE_BASE_URL).digest("hex").slice(0, 32), "zcode-builtin.json");
const bundled = JSON.parse(fs.readFileSync(process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE));
const source = !${isolates} && fs.existsSync(legacy) ? legacy : file;
const active = fs.existsSync(source) ? JSON.parse(fs.readFileSync(source)) : bundled;
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(active));
`,
    );
    const check = verifyPackagedSubscriptions({
      executable: process.execPath,
      resources,
    });
    if (isolates) await expect(check).resolves.toBe("passed");
    else await expect(check).rejects.toThrow("Old ZCode directory must remain isolated");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
