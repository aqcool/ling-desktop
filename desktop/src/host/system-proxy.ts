import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const execute = promisify(execFile)
const proxyNames = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']

/** Use the user's macOS static proxy only when DSH has no explicit proxy policy. */
export async function withSystemProxy(
  environment: LaunchEnvironmentSnapshot,
  options: {
    platform?: NodeJS.Platform
    read?: () => Promise<string>
    warn?: (message: string) => void
  } = {},
): Promise<LaunchEnvironmentSnapshot> {
  if ((options.platform ?? process.platform) !== 'darwin'
    || proxyNames.some(name => environment.get(name) !== undefined)) return environment
  const warn = options.warn ?? (message => { process.stderr.write(`LING: ${message}\n`) })
  let output: string
  try {
    output = await (options.read ?? (async () => (await execute('/usr/sbin/scutil', ['--proxy'], { timeout: 5000 })).stdout))()
  } catch {
    warn('无法读取系统代理设置。')
    return environment
  }
  const field = (name: string) => output.match(new RegExp(`^\\s*${name}\\s*:\\s*(.*?)\\s*$`, 'm'))?.[1]
  // A PAC result can vary by destination; never turn it into a global static proxy.
  if (field('ProxyAutoConfigEnable') === '1' || field('ProxyAutoDiscoveryEnable') === '1') {
    warn('DSH 后台暂不支持系统自动代理脚本；请使用 DSH 的显式 HTTP/HTTPS 代理配置。')
    return environment
  }
  const values: Record<string, string> = {}
  for (const scheme of ['HTTP', 'HTTPS']) {
    if (field(`${scheme}Enable`) !== '1') continue
    const host = field(`${scheme}Proxy`)
    const port = Number(field(`${scheme}Port`))
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue
    const address = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    try { values[`${scheme}_PROXY`] = new URL(`http://${address}:${port}`).href } catch {}
  }
  if (!Object.keys(values).length) return environment
  if (values.HTTP_PROXY && !values.HTTPS_PROXY) {
    // DSH falls back from HTTPS to HTTP_PROXY, unlike macOS's independent toggles.
    warn('系统仅启用 HTTP 代理，无法无损映射到 DSH 的代理策略；保留现有后台网络配置。')
    return environment
  }
  const exceptions = output.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/)?.[1]
  if (exceptions && !environment.get('no_proxy') && !environment.get('NO_PROXY')) {
    values.NO_PROXY = [...exceptions.matchAll(/^\s*\d+\s*:\s*(\S+)\s*$/gm)].map(match => match[1]).join(',')
  }
  const fallback = (name: string) => values[name] === undefined ? undefined : { value: values[name]!, source: 'process' as const }
  return Object.freeze({
    get: name => environment.get(name) ?? fallback(name),
    getFrom: (name, sources) => environment.getFrom(name, sources) ?? (sources.includes('process') ? fallback(name) : undefined),
  } satisfies LaunchEnvironmentSnapshot)
}
