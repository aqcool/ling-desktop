import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { writeLingUpdateManifest } from "../../.github/scripts/ling-update-manifest.mjs";

test("publishes separate platform manifests with checksums of the actual GitHub assets", async () => {
  const output = await mkdtemp(join(tmpdir(), "ling-release-manifest-"));
  const version = "3.18.4";
  const targets = {
    "mac-arm64": [".zip"],
    "mac-x64": [".zip"],
    "win-x64": [".exe"],
    "linux-x64": [".AppImage", ".deb"],
  };
  try {
    for (const [target, extensions] of Object.entries(targets)) {
      const files = await Promise.all(
        extensions.map(async (extension) => {
          const url = `LING-${version}-${target}${extension}`;
          const data = Buffer.from(url);
          await writeFile(join(output, url), data);
          return {
            url,
            sha512: createHash("sha512").update(data).digest("base64"),
            size: data.length,
          };
        }),
      );
      await writeLingUpdateManifest({ output, target, version });
      const manifest = JSON.parse(
        await readFile(join(output, `ling-update-${target}.json`), "utf8"),
      );
      expect(manifest).toEqual({
        version,
        files,
        ...(target.startsWith("mac-") ? { minimumSystemVersion: "22.0.0" } : {}),
      });
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("fails qualification if the selected update asset is missing", async () => {
  const output = await mkdtemp(join(tmpdir(), "ling-release-missing-"));
  try {
    await expect(
      writeLingUpdateManifest({ output, target: "mac-x64", version: "3.18.4" }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
