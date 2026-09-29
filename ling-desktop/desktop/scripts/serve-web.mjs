import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesktopHostProcess } from '../lib/host-process.js'
import { ensureLingProfile } from '../lib/profile.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = process.env.LING_DESKTOP_WEB_HOME ?? join(root, '.web-serve')
mkdirSync(home, { recursive: true, mode: 0o700 })
const projectDir = ensureLingProfile(home)
const host = new DesktopHostProcess(
  process.execPath, root, projectDir, undefined,
  { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  error => { console.error(`LING Host stopped: ${error.message}`) },
  undefined, 'runtime', undefined, join(root, 'lib', 'host.js'),
)
let ready
try {
  ready = await host.start()
} catch (error) {
  console.error(`LING Host failed to start: ${error instanceof Error ? error.message : String(error)}`)
  await host.stop()
  process.exit(1)
}
console.log(`\nLING local app:\n  ${ready.url}\nCtrl-C stops the Host.\n`)
const stop = () => { void host.stop().finally(() => process.exit(0)) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await new Promise(() => {})
