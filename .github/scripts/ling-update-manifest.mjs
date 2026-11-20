import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const updateExtensions = {
  "mac-arm64": [".zip"],
  "mac-x64": [".zip"],
  "win-x64": [".exe"],
  "linux-x64": [".AppImage", ".deb"],
};

export async function writeLingUpdateManifest({ output, target, version }) {
  const extensions = updateExtensions[target];
  if (!extensions) throw new Error(`Unsupported LING update target: ${target}`);
  const files = await Promise.all(
    extensions.map(async (extension) => {
      const url = `LING-${version}-${target}${extension}`;
      const path = join(output, url);
      const { size } = await stat(path);
      if (!size) throw new Error(`Empty LING update artifact: ${url}`);
      const hash = createHash("sha512");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      return { url, sha512: hash.digest("base64"), size };
    }),
  );
  const manifest = {
    version,
    files,
    ...(target.startsWith("mac-") ? { minimumSystemVersion: "22.0.0" } : {}),
  };
  await writeFile(
    join(output, `ling-update-${target}.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
