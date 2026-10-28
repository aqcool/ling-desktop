/** Sign the installed macOS native slice before sealing the enclosing app. */
import { execFile } from 'node:child_process'
import { open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { json, runtimeFiles } from './runtime.mjs'

const execute = promisify(execFile)
export function isMachO(header) {
  return header.length >= 4 && ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.subarray(0, 4).toString('hex'))
}

export async function signMacRuntime(context, target) {
  // This seam is checked against the pinned electron-builder 26.15.7. Reuse its
  // temporary keychain rather than importing or printing certificate material.
  const { keychainFile } = await context.packager.codeSigningInfo.value
  const identity = await context.packager.helper.findSigningIdentity(false, false,
    context.packager.platformSpecificBuildOptions.identity, keychainFile, context.packager.platformSpecificBuildOptions)
  if (!identity?.name.startsWith('Developer ID Application:')) throw new Error('Developer ID identity is required for the runtime')
  const runtime = join(context.appOutDir, 'LING.app/Contents/Resources/runtime')
  const manifest = await json(join(runtime, 'ling-runtime.json'))
  let count = 0
  for (const entry of manifest.files) {
    const path = join(runtime, entry.path), handle = await open(path, 'r')
    const header = Buffer.alloc(4)
    try { await handle.read(header, 0, 4, 0) } finally { await handle.close() }
    // SSH helper tarballs and ELF/PE payloads are immutable data, never resigned.
    if (!isMachO(header)) continue
    const architectures = (await execute('/usr/bin/lipo', ['-archs', path])).stdout.trim().split(/\s+/)
    if (!architectures.includes(target.arch === 'x64' ? 'x86_64' : target.arch)) throw new Error(`Foreign macOS binary in native runtime: ${entry.path}`)
    await execute('/usr/bin/codesign', ['--force', '--sign', identity.hash, '--timestamp', '--options', 'runtime',
      ...(keychainFile ? ['--keychain', keychainFile] : []), path])
    await execute('/usr/bin/codesign', ['--verify', '--strict', path])
    count++
  }
  // Builder ignores runtime during its recursive signing. Record precisely the
  // signed bytes now, before it seals and notarizes the outer application.
  manifest.files = await runtimeFiles(runtime)
  manifest.nativeSigning = { kind: 'developer-id', files: count }
  await writeFile(join(runtime, 'ling-runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return count
}

export async function verifyReleaseSignature(path, target) {
  if (target.platform === 'darwin') {
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', path])
    await execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', path])
    await execute('/usr/bin/xcrun', ['stapler', 'validate', path])
  } else if (target.platform === 'win32') {
    const script = "$s=Get-AuthenticodeSignature -LiteralPath $env:LING_SIGN_VERIFY_PATH; if($s.Status -ne 'Valid'){throw 'Authenticode signature is invalid'}; if($s.SignerCertificate.GetNameInfo('SimpleName',$false) -ne $env:LING_WINDOWS_PUBLISHER_NAME){throw 'Authenticode publisher differs from update policy'}"
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, LING_SIGN_VERIFY_PATH: path } })
  }
}
