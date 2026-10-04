/** Runs only in the staged/final Electron Node runtime. Never opens a window,
 * touches an existing user home, connects SSH, or sends an agent message.
 */
import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

// macOS exposes the same temporary directory through /var and /private/var;
// Node resolves package paths to the latter. Compare canonical paths.
const runtime = await realpath(resolve(process.argv[2]))
const hostRoot = join(runtime, 'node_modules', 'ling-desktop-host')
const require = createRequire(join(hostRoot, 'package.json'))
const scratch = await mkdtemp(join(tmpdir(), 'ling-package-smoke-'))
const systemPath = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32') : '/usr/bin:/bin'
const environment = { ...process.env, HOME: scratch, DSH_HOME: join(scratch, 'home'), LING_DESKTOP_HOME: join(scratch, 'home'),
  PATH: systemPath, NODE_PATH: '', NODE_OPTIONS: '', DSH_TELEMETRY_DISABLED: '1',
  HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_NODE_EXECUTABLE: process.execPath }
const execute = promisify(execFile)
const verified = []
let child

async function checkPackageScripts() {
  await writeFile(join(scratch, 'package.json'), JSON.stringify({ name: 'ling-package-probe', private: true, scripts: { check: 'node check.cjs' } }))
  await writeFile(join(scratch, 'check.cjs'), `const a=require('node:assert/strict');a.ok(process.versions.electron);a.equal(process.execPath,${JSON.stringify(process.execPath)});a.ok(process.execArgv.includes('--expose-internals'));console.log('ling-node-launcher-ok')`)
  const pnpm = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')
  const result = await execute(process.execPath, ['--expose-internals', pnpm, 'run', 'check'], {
    cwd: scratch, env: { ...environment, PATH: `${join(hostRoot, 'scripts/node-bin')}${delimiter}${systemPath}` }, timeout: 45_000,
  })
  assert.match(result.stdout, /ling-node-launcher-ok/)
  verified.push('bundled-pnpm-and-node')
}

async function checkNative() {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  assert.equal(db.prepare('select 7 as value').get().value, 7); db.close()
  const lock = await open(join(scratch, 'lock'), 'w')
  try { await require('@deepseek-ai/node-addon-system/flock').tryLockExclusive(lock.fd) } finally { await lock.close() }
  const koffi = require('koffi'), library = koffi.load(process.platform === 'win32' ? 'kernel32.dll' : null)
  try { assert.equal(library.func(process.platform === 'win32' ? 'uint32_t __stdcall GetCurrentProcessId(void)' : 'int getpid(void)')(), process.pid) } finally { library.unload() }
  const sharp = require('sharp'), pixels = Buffer.from([16, 100, 230])
  const png = await sharp(pixels, { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer()
  assert.deepEqual(await sharp(png).raw().toBuffer(), pixels)
  const { rgPath } = require('@vscode/ripgrep')
  assert.ok(rgPath.startsWith(`${runtime}${sep}`))
  assert.match(execFileSync(rgPath, ['--version'], { env: environment, encoding: 'utf8' }), /ripgrep/)
  const { Parser, Language } = require('@vscode/tree-sitter-wasm'), wasm = dirname(require.resolve('@vscode/tree-sitter-wasm'))
  await Parser.init({ locateFile: file => join(wasm, file) })
  for (const name of ['typescript', 'tsx', 'javascript', 'go', 'python', 'rust', 'java']) {
    const parser = new Parser()
    try { parser.setLanguage(await Language.load(join(wasm, `tree-sitter-${name}.wasm`))); const tree = parser.parse(''); assert.ok(tree); tree.delete() }
    finally { parser.delete() }
  }
  const pty = require('node-pty')
  await new Promise((accept, reject) => {
    const terminal = pty.spawn(process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh', process.platform === 'win32' ? ['/d', '/c', 'echo ling-packaged-pty-ok'] : ['-c', 'printf ling-packaged-pty-ok'], { cwd: scratch, env: environment, cols: 80, rows: 24 })
    let output = ''
    const data = terminal.onData(value => { output += value })
    const timer = setTimeout(() => { terminal.kill(); reject(new Error('Packaged PTY timed out')) }, 15_000)
    const exit = terminal.onExit(event => {
      clearTimeout(timer); data.dispose(); exit.dispose()
      try { assert.equal(event.exitCode, 0); assert.match(output, /ling-packaged-pty-ok/); accept() } catch (error) { reject(error) }
    })
  })
  verified.push('sqlite-flock-koffi-sharp-ripgrep-tree-sitter-pty')
}

async function checkDocument() {
  const inputPath = join(scratch, 'document.docx'), outputPath = join(scratch, 'document.pdf')
  const { zipSync, strToU8 } = createRequire(require.resolve('@deepseek-ai/libreoffice-kit'))('fflate')
  await writeFile(inputPath, zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>LING packaged document preview</w:t></w:r></w:p></w:body></w:document>'),
  }))
  const converter = await require('@deepseek-ai/libreoffice-kit').createConverter()
  try {
    assert.ok(['native', 'wasm'].includes(converter.backend))
    await converter.render({ inputPath, outputPath }, AbortSignal.timeout(90_000))
    assert.equal((await readFile(outputPath)).subarray(0, 5).toString(), '%PDF-')
  } finally { await converter.dispose() }
  verified.push('document-pdf-conversion')
}

async function checkHost() {
  const { ensureLingProfile } = await import(pathToFileURL(join(hostRoot, 'lib/profile.js')).href)
  const profile = ensureLingProfile(environment.DSH_HOME)
  child = spawn(process.execPath, ['--expose-internals', join(hostRoot, 'lib/host.js'), hostRoot, profile], {
    cwd: scratch, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let diagnostic = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', block => { diagnostic = (diagnostic + block).slice(-16000) })
  const ready = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(`Packaged Host timed out: ${diagnostic}`)), 45_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Packaged Host exited ${code}: ${diagnostic}`)) })
    child.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); accept(message) }
      if (message.type === 'fatal') { clearTimeout(timer); reject(new Error(`Packaged Host failed: ${message.message}`)) }
    })
  })
  assert.ok(ready.injections?.length)
  const authenticated = new URL(ready.url)
  assert.equal(authenticated.hostname, '127.0.0.1')
  const login = await fetch(authenticated, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const response = await fetch(new URL('/ling-renderer.css', authenticated), { headers: { cookie: cookies }, signal: AbortSignal.timeout(10000) })
  assert.equal(response.status, 200)
  assert.match(await response.text(), /--surface/)
  // Validate the actual package anchors used by Electron, including the
  // shipped factory wrapper and fonts, without loading development modules.
  const webRoot = dirname(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))
  assert.match(await readFile(join(webRoot, 'index.html'), 'utf8'), /<html/)
  assert.match(await readFile(join(hostRoot, 'lib/client.js'), 'utf8'), /id: "ling-desktop-host"/)
  assert.equal((await readFile(join(hostRoot, 'lib/ssh-runtime.tar.gz'))).subarray(0, 2).toString('hex'), '1f8b')
  await new Promise((accept, reject) => {
    let clean = false
    const timer = setTimeout(() => reject(new Error('Packaged Host shutdown timed out')), 15_000)
    child.on('message', message => { if (message.type === 'shutdown-complete') clean = true })
    child.once('exit', code => { clearTimeout(timer); try { assert.ok(clean); assert.equal(code, 0); accept() } catch (error) { reject(error) } })
    child.send({ type: 'shutdown' })
  })
  child = undefined
  verified.push('host-profile-client-css-ssh-assets-clean-shutdown')
}

try {
  assert.ok(process.versions.electron, 'Run with the packaged Electron executable in Node mode')
  await checkPackageScripts()
  await checkNative()
  await checkDocument()
  await checkHost()
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, electron: process.versions.electron, verified }))
} finally {
  if (child?.exitCode === null) {
    const stopped = new Promise(accept => child.once('exit', accept))
    child.kill('SIGKILL'); await stopped
  }
  await rm(scratch, { recursive: true, force: true })
}
