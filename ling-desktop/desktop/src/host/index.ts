/** Local DSH engine for the LING application. */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { loadLingProfile, LING_HOST_PACKAGE } from '../profile.ts'
import { bundledPnpmEntry } from '../extensions.ts'
import { withSystemProxy } from './system-proxy.ts'
import { ServerBridge, installServerBridge } from './server-bridge.ts'

export async function main(): Promise<void> {
  const runtimeDir = process.argv[2]
  const projectDir = process.argv[3]
  const home = process.env.DSH_HOME
  if (!runtimeDir || !projectDir || !home || !process.send) throw new Error('LING Host requires runtime, profile, home and IPC')
  const profile = loadLingProfile(projectDir, home)
  const serverBridge = new ServerBridge(message => {
    if (!process.connected || !process.send) throw new Error('远端服务已断开。')
    process.send(message)
  })
  installServerBridge(serverBridge)
  const environment = await withSystemProxy(loadLayeredEnv('ling-desktop-host'))
  const application = runProfile({
    environment, profile: basename(projectDir),
    resolutionMode: 'runtime', resolvedProfile: { profile, installAnchor: LING_HOST_PACKAGE },
    patchFiles: [join(runtimeDir, 'host.cordis.patch.yml')], args: ['--no-open', '--port', '0'],
    packageManager: {
      command: process.execPath, args: ['--expose-internals', bundledPnpmEntry(LING_HOST_PACKAGE)],
      env: {
        DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        PATH: `${join(runtimeDir, 'scripts', 'node-bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
    },
  })
  const send = (value: object): Promise<void> => new Promise((resolveSend, reject) => {
    if (!process.connected || !process.send) return resolveSend()
    process.send(value, error => error ? reject(error) : resolveSend())
  })
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => stopping ??= (async () => {
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
  })()
  process.on('message', (value: unknown) => {
    if (serverBridge.receive(value)) return
    if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'shutdown') void stop().catch(fatal)
  })
  process.once('disconnect', () => { serverBridge.close(); void stop().catch(fatal) })
  const { ctx } = await application
  // Plain browsers need the same stylesheet Electron maps from the package dist.
  const stylesheet = join(dirname(createRequire(LING_HOST_PACKAGE).resolve('ling-desktop/package.json')), 'dist', 'renderer.css')
  ctx.webServer.register({ kind: 'exact', path: '/ling-renderer.css', handler: async (_req, res) => {
    try {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' })
      res.end(await readFile(stylesheet))
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end('LING stylesheet is not built yet')
    }
  } })
  await send({ type: 'ready', url: ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`),
    injections: ctx.webServer.collectIndexInjections() })
}


function fatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (process.connected) process.send?.({ type: 'fatal', message }, () => { if (process.connected) process.disconnect() })
  console.error(error)
  process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main().catch(fatal)
