import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const {
  TARGET_OS: os,
  TARGET_ARCH: arch,
  RELEASE_VERSION: version,
  RELEASE_REVISION: revision,
} = process.env;
const target = `${os}-${arch}`;
const dist = resolve("source/packages/desktop/dist");
const output = resolve("release-assets");
const prefix = `LING-${version}-${target}`;

const layouts = {
  "mac-arm64": ["mac-arm64/LING.app/Contents", "MacOS/LING", "Resources", [".dmg"]],
  "mac-x64": ["mac/LING.app/Contents", "MacOS/LING", "Resources", [".dmg"]],
  "win-x64": ["win-unpacked", "LING.exe", "resources", [".exe"]],
  "linux-x64": ["linux-unpacked", "ling", "resources", [".AppImage", ".deb"]],
};
const layout = layouts[target];
assert(layout, `Unsupported release target: ${target}`);
assert.equal(process.platform, { mac: "darwin", win: "win32", linux: "linux" }[os]);
assert.equal(process.arch, arch);

const [appPath, executablePath, resourcesPath, extensions] = layout;
const executable = join(dist, appPath, executablePath);
const resources = join(dist, appPath, resourcesPath);
const agent = join(resources, "glm", "zcode.cjs");
const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
const run = (args) =>
  execFileSync(executable, args, { env, encoding: "utf8", timeout: 60_000 }).trim();

assert.equal(run(["-p", "process.arch"]), arch);
const agentVersion = run([agent, "--version"]);
assert.match(agentVersion, /\d+\.\d+\.\d+/, "Packaged agent must respond with its version");

mkdirSync(output, { recursive: true });
const files = readdirSync(dist);
for (const extension of extensions) {
  const matches = files.filter(
    (name) => name.startsWith(`LING-${version}-`) && name.endsWith(extension),
  );
  assert.equal(
    matches.length,
    1,
    `Expected one ${extension} installer, found ${matches.join(", ")}`,
  );
  const source = join(dist, matches[0]);
  assert(statSync(source).size > 0, `Empty installer: ${source}`);
  if (extension === ".dmg") execFileSync("hdiutil", ["verify", source], { stdio: "inherit" });
  if (extension === ".deb") {
    assert.equal(
      execFileSync("dpkg-deb", ["--field", source, "Architecture"], { encoding: "utf8" }).trim(),
      "amd64",
    );
  }
  copyFileSync(source, join(output, `${prefix}${extension}`));
}
writeFileSync(
  join(output, `${prefix}-report.json`),
  JSON.stringify({ target, version, revision, agentVersion, agentSmoke: "passed" }, null, 2) + "\n",
);
