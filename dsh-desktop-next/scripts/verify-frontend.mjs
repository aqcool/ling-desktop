/** Check the real official Web entry and sandboxed preload bundles without a GUI. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { serveWebDocument } from '../lib/web-document.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const webRoot = dirname(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))
const lingRoot = join(dirname(require.resolve('ling-desktop/package.json')), 'dist')
const official = readFileSync(join(webRoot, 'index.html'), 'utf8')
const local = await serveWebDocument(new Request('dsh-app://app/'), webRoot)
const html = await local.text()
assert.equal(local.status, 200)
assert.equal(html.replace('<script>globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()</script>', ''), official)
assert.ok(html.includes('/assets/'), 'Official production frontend must carry built assets')
const stylesheet = await serveWebDocument(new Request('dsh-app://app/renderer.css'), lingRoot)
assert.equal(stylesheet.status, 200)
assert.match(await stylesheet.text(), /\.desktop-shell\{/)
const client = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
assert.ok(client.includes('ctx.reflect.provide("uiRenderer"'), 'Next client must provide the LING renderer')
assert.ok(client.includes('/ling-renderer.css'), 'Next client must load the LING renderer stylesheet')
assert.ok(!client.includes('require("ling-desktop/'), 'LING renderer code must be self-contained in the client bundle')
assert.ok(!client.includes('process.env.NODE_ENV'), 'Client bundle must not depend on a Node process global')

for (const platform of ['darwin', 'win32', 'linux']) {
  const exposed = new Map()
  const dataset = {}
  for (const [entry, hostname] of [['preload-app.cjs', 'app'], ['preload-shell.cjs', 'shell']]) {
    runInNewContext(readFileSync(join(root, 'lib', entry), 'utf8'), {
      require: name => {
        assert.equal(name, 'electron', 'Sandboxed preloads may not require local chunks or Node modules')
        return { contextBridge: { exposeInMainWorld: (name, api) => exposed.set(name, api) }, ipcRenderer: { invoke() {}, send() {} } }
      },
      process: { platform }, location: { protocol: 'dsh-app:', hostname },
      document: { readyState: 'loading', documentElement: { dataset, style: { setProperty() {} } } },
      window: { addEventListener() {} }, console,
    }, { filename: entry })
  }
  assert.equal(dataset.platform, platform)
  assert.equal(exposed.get('dshDesktop')?.protocolVersion, 1)
  assert.equal(typeof exposed.get('dshDesktopBoot')?.ready, 'function')
  assert.equal(typeof exposed.get('__DSH_DIRECTORY_PICKER__')?.pick, 'function')
  assert.equal(typeof exposed.get('desktopNext')?.command, 'function')
}
console.log('Next frontend check passed: official alpha.2 boot, LING renderer assets and sandboxed preloads for macOS, Windows and Linux.')
