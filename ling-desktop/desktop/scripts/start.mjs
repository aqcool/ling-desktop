import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
for (const file of ['lib/main.js', 'lib/host.js', 'lib/client.js', 'lib/preload-app.cjs', 'lib/preload-browser.cjs']) {
  if (!existsSync(join(root, file))) throw new Error('Build LING first with corepack yarn dev:ling.')
}
const electron = createRequire(join(root, 'package.json'))('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [root], { cwd: root, env, stdio: 'inherit' })
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 1 })
