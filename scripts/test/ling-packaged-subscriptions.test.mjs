import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { verifyPackagedSubscriptions } from "../../.github/scripts/packaged-subscriptions.mjs";

test.each([true, false])("发行检查识别包内程序能否恢复订阅模板：%s", async (restores) => {
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
          modelConfigRules: {},
        },
      }),
    );
    // 小程序只作为发行检查的输入夹具，验证检查会拒绝“能启动但丢入口”的产物。
    await writeFile(
      join(resources, "glm/zcode.cjs"),
      `const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.ZCODE_DATA_BASE_DIR, 'zcode-builtin.json');
const bundled = JSON.parse(fs.readFileSync(process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE));
const active = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : bundled;
if (${restores}) active.config.providerConfigRules.templateRules = bundled.config.providerConfigRules.templateRules;
fs.writeFileSync(file, JSON.stringify(active));
`,
    );
    const check = verifyPackagedSubscriptions({
      executable: process.execPath,
      resources,
    });
    if (restores) await expect(check).resolves.toBe("passed");
    else await expect(check).rejects.toThrow("Packaged agent lost claude-subscription");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
