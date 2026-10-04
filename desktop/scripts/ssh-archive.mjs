import { create } from 'tar'

export function sshArchiveMode(path, type, mode, platform) {
  if (platform !== 'win32') return mode
  // Windows does not expose Unix executable bits. These two pinned native
  // helpers must remain executable when the archive is extracted remotely.
  return type === 'Directory' || /(?:^|\/)(?:spawn-helper|landlock-run)$/.test(path) ? 0o755 : 0o644
}
export async function writeSshArchive(file, cwd, entries, platform = process.platform) {
  await create({ file, cwd, portable: true, noMtime: true, noDirRecurse: true, strict: true,
    onWriteEntry(entry) { entry.stat.mode = sshArchiveMode(entry.path, entry.type, entry.stat.mode, platform) },
  }, entries)
}
