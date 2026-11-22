import { execFile } from "node:child_process";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const commandOptions = { timeout: 120_000 };

export async function verifyMacReleaseSignature({
  appPath,
  imagePath,
  requireNotarization = false,
  run = execute,
}) {
  // 修复原因：旧发行检查只在自动更新开启时验证签名，手动版因此放过了 3.18.6 的无效签名。
  // 构建目录及最终镜像中的 app 都必须通过完整性检查，不能在验收时补签或删除隔离属性。
  const verify = (path) =>
    run("codesign", ["--verify", "--deep", "--strict", path], commandOptions);
  await verify(appPath);
  const mountPath = await mkdtemp(join(tmpdir(), "ling-release-signature-"));
  let mounted = false;
  try {
    await run(
      "hdiutil",
      ["attach", "-readonly", "-nobrowse", "-mountpoint", mountPath, imagePath],
      commandOptions,
    );
    mounted = true;
    await verify(join(mountPath, "LING.app"));
  } finally {
    if (mounted) await run("hdiutil", ["detach", mountPath], commandOptions);
    // 卸载失败时保留挂载点；禁止递归清理仍然挂载的镜像内容。
    await rmdir(mountPath);
  }
  if (requireNotarization) {
    await run("xcrun", ["stapler", "validate", appPath], commandOptions);
    await run("codesign", ["--verify", imagePath], commandOptions);
    await run("xcrun", ["stapler", "validate", imagePath], commandOptions);
  }
}
