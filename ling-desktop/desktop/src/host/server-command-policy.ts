import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

/** A deliberately bounded shell subset. Anything we cannot inspect still goes to approval. */
function commandParts(source: string): string[][] | undefined {
  const parts: string[][] = []
  let words: string[] = []
  let word = ''
  let started = false
  let quote = ''
  let pending = false
  const flush = () => { if (started) words.push(word); word = ''; started = false }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    if (quote === "'") {
      if (c === "'") quote = ''; else word += c
      continue
    }
    if (c === '\\') {
      const next = source[++i]
      if (next === undefined) return
      if (next !== '\n') {
        if (quote === '"' && !['"', '\\', '$', '`'].includes(next)) word += '\\'
        word += next; started = true
      }
      continue
    }
    if (c === '$' || c === '`') return // substitutions and expansion can change the actual command
    if (quote === '"') {
      if (c === '"') quote = ''; else word += c
      continue
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue }
    if (!started) {
      // Only discard output, or merge stdout/stderr. Never approve a file redirection implicitly.
      const redirect = source.slice(i).match(/^(?:[12])?(?:>&[12]|>\s*\/dev\/null)(?=\s|$|[;|&])/)
      if (redirect) { i += redirect[0].length - 1; continue }
      if (c === '#') { while (i + 1 < source.length && source[i + 1] !== '\n') i++; continue }
    }
    if ('<>()[{}*?~'.includes(c)) return
    if (c === '\n' || c === ';' || c === '|' || c === '&') {
      flush()
      const paired = (c === '|' || c === '&') && source[i + 1] === c
      if (paired) i++
      if (c === '&' && !paired) return
      if (!words.length) {
        if (c === '\n' && !pending) continue
        return
      }
      parts.push(words); words = []
      pending = c === '|' || c === '&'
      continue
    }
    if (/\s/.test(c)) { flush(); continue }
    word += c; started = true; pending = false
  }
  if (quote || pending) return
  flush()
  if (words.length) parts.push(words)
  return parts.length ? parts : undefined
}

function executable(word: string): string | undefined {
  if (!word.includes('/')) return word
  // A project script named "ls" is not the system ls.
  return word.match(/^\/(?:usr\/)?s?bin\/([^/]+)$/)?.[1]
}

/** Parse flags without letting an option's value become a subcommand. ':' marks a value option. */
function operands(args: string[], flags: string): string[] | undefined {
  const options = new Map(flags.split(' ').filter(Boolean).map(flag => [flag.replace(/[:?]$/, ''), flag.endsWith(':') ? 'required' : flag.endsWith('?') ? 'optional' : 'none']))
  const result: string[] = []
  const consume = (flag: string, index: number): number | undefined => {
    const mode = options.get(flag)
    if (mode === undefined) return
    if (mode === 'none') return index
    const next = args[index + 1]
    if (next !== undefined && !next.startsWith('-')) return index + 1
    if (mode === 'optional') return index
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') { result.push(...args.slice(i + 1)); break }
    if (!arg.startsWith('-') || arg === '-') { result.push(arg); continue }
    if (options.has(arg)) {
      const next = consume(arg, i)
      if (next === undefined) return
      i = next
    } else if (arg.startsWith('--')) {
      const equals = arg.indexOf('=')
      const flag = equals < 0 ? arg : arg.slice(0, equals)
      const value = options.get(flag)
      if (value === undefined || equals < 0 || value === 'none') return
    } else {
      for (let j = 1; j < arg.length; j++) {
        const value = options.get(`-${arg[j]}`)
        if (value === undefined) return
        if (value !== 'none') {
          if (j === arg.length - 1) {
            const next = consume(`-${arg[j]}`, i)
            if (next === undefined) return
            i = next
          }
          break
        }
      }
    }
  }
  return result
}

const simpleQueries = new Set([
  'pwd', 'ls', 'uname', 'uptime', 'whoami', 'id', 'who', 'w', 'df', 'du', 'free', 'ps', 'pgrep',
  'lsblk', 'lscpu', 'lsof', 'netstat', 'cat', 'head', 'tail', 'wc', 'stat', 'readlink', 'realpath',
  'grep', 'egrep', 'fgrep', 'sha256sum', 'sha512sum', 'md5sum', 'shasum', 'echo', 'true', 'false',
])
const serviceQueries = new Set(['status', 'show', 'is-active', 'is-enabled', 'is-failed', 'list-units',
  'list-unit-files', 'list-sockets', 'list-timers', 'list-jobs', 'list-dependencies', 'get-default'])
const serviceFlags = '--user --system --no-pager --no-legend --plain --full --all --failed -a -l -q --quiet --type: -t: --state: --property: -p: -P: --value --lines: -n:'
const gitQueries = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'show-ref', 'diff-files', 'diff-index'])

function query(words: string[]): boolean {
  const args = [...words]
  let name = executable(args.shift() ?? '')
  if (name === 'sudo') {
    while (args[0]?.startsWith('-')) {
      const flag = args.shift()
      if (flag === '--') break
      if (flag === '-n') continue
      if (flag === '-u' && args[0] && /^[a-z_][a-z0-9_-]*$/i.test(args[0])) { args.shift(); continue }
      return false
    }
    name = executable(args.shift() ?? '')
  }
  if (name === 'command') {
    if (args[0] === '-v' || args[0] === '-V') return true
    if (args[0] === '--') args.shift()
    name = executable(args.shift() ?? '')
  }
  if (!name) return false
  if (simpleQueries.has(name)) return true
  switch (name) {
    case 'cd': return args.length <= 1 && (!args[0]?.startsWith('-') || args[0] === '-')
    case 'printf': return !!args[0] && !args[0].startsWith('-') && !/%(?:\d+\$)?n/.test(args[0])
    case 'hostname': return operands(args, '-s -f -d -i -I --short --fqdn --domain --ip-address --all-ip-addresses')?.length === 0
    case 'date': {
      const values = operands(args, '-u --utc -R --rfc-email -I: --iso-8601:')
      return values !== undefined && values.every(value => value.startsWith('+'))
    }
    case 'ss': return operands(args, '-a -l -n -t -u -x -p -e -o -i -s -4 -6 -H --all --listening --numeric --tcp --udp --unix --processes --summary') !== undefined
    case 'journalctl': return operands(args, '--no-pager --no-hostname --quiet -q --all -a --follow -f --reverse -r --boot? -b? --unit: -u: --user-unit: --lines? -n? --since: -S: --until: -U: --priority: -p: --output: -o: --grep: -g: --identifier: -t: --system --user --disk-usage --list-boots -k --dmesg -e --pager-end -x --catalog') !== undefined
    case 'systemctl': {
      const values = operands(args, serviceFlags)
      return values !== undefined && serviceQueries.has(values[0] ?? '')
    }
    case 'service': return args.length === 2 && args[1] === 'status'
    case 'ip': {
      const values = operands(args, '-br -brief -4 -6 -o -oneline -s -statistics -j -json -p -pretty')
      return values !== undefined && ['addr', 'address', 'link', 'route', 'neigh', 'neighbor'].includes(values[0] ?? '')
        && (values.length === 1 || ['show', 'list', 'get'].includes(values[1] ?? ''))
    }
    case 'find': return operands(args, '-H -L -P -name: -iname: -path: -ipath: -regex: -iregex: -type: -maxdepth: -mindepth: -size: -mtime: -mmin: -atime: -ctime: -user: -group: -perm: -newer: -print -print0 -printf: -ls -empty -readable -writable -executable -prune -xdev -mount -not -a -and -o -or')?.every(value => !value.startsWith('-')) === true
    case 'sed': {
      const values = operands(args, '-n --quiet --silent -E -r')
      return values !== undefined && /^(?:\d+(?:,\d+|,\$)?|\$)?[pq=]$/.test(values[0] ?? '')
    }
    case 'sort': return operands(args, '-n -r -h -V -u -b -f -g -s -k: -t: --numeric-sort --reverse --human-numeric-sort --version-sort --unique --key: --field-separator:') !== undefined
    case 'git': {
      // Only these global flags precede a known built-in; custom aliases/config are not admitted.
      while (args[0]?.startsWith('-')) {
        const flag = args.shift()
        if (flag === '--no-pager' || flag === '--no-optional-locks') continue
        if (flag === '-C' && args.shift()) continue
        return false
      }
      const subcommand = args.shift() ?? ''
      if (args.some(arg => /^--(?:out|ext|text|exec|open)/.test(arg))) return false
      return gitQueries.has(subcommand)
        || (subcommand === 'branch' && operands(args, '--list -a --all -r --remotes -v --verbose --show-current --no-color')?.length === 0)
        || (subcommand === 'remote' && (args.length === 0 || args.every(arg => arg === '-v' || arg === '--verbose')))
    }
    case 'docker': {
      const subcommand = args.shift()
      if (['ps', 'images', 'inspect', 'logs', 'top', 'stats', 'version', 'info'].includes(subcommand ?? '')) return true
      if (subcommand === 'system') return args[0] === 'df'
      if (subcommand === 'container') return ['ls', 'logs', 'top', 'stats'].includes(args[0] ?? '')
      if (subcommand === 'image') return args[0] === 'ls'
      if (subcommand === 'compose') {
        while (args[0]?.startsWith('-')) {
          const flag = args.shift()
          if (['-f', '--file', '-p', '--project-name', '--project-directory'].includes(flag ?? '') && args.shift()) continue
          return false
        }
        return ['ps', 'logs', 'top', 'images', 'version'].includes(args[0] ?? '')
      }
      return false
    }
    default: return false
  }
}

/** Recognize literal inspection commands and inspect every stage of pipes/command lists. */
export function isServerQuery(command: unknown): boolean {
  if (typeof command !== 'string' || !command.trim() || command.length > 16384 || command.includes('\0')) return false
  const parts = commandParts(command)
  return parts !== undefined && parts.every(query)
}

export function serverCommandImpact(command: string): string {
  const parts = commandParts(command)
  const mutations = (parts ?? []).filter(words => !query(words)).map(words => words.join(' ')).join(' ; ')
  const effects: string[] = []
  if (/\b(rm|rmdir|shred|truncate|mkfs|wipefs)\b/.test(mutations)) effects.push('可能删除文件或清空数据，删除后不一定能恢复。')
  if (/\b(restart|reload|stop|start|reboot|shutdown|kill|killall|pkill)\b/.test(mutations)) effects.push('会改变服务或进程状态，访问可能短暂中断。')
  if (/\b(chmod|chown|chgrp|usermod|useradd|iptables|ufw|firewall-cmd)\b/.test(mutations)) effects.push('会修改权限、账号或网络访问规则，可能影响连接与服务访问。')
  if (/\b(install|upgrade|update|apt|apt-get|yum|dnf|pip|npm|pnpm|yarn)\b/.test(mutations)) effects.push('可能安装或更新软件、执行项目脚本，并修改服务器文件。')
  if (/\b(cp|mv|tee|rsync|touch|mkdir|ln)\b/.test(mutations)) effects.push('会创建、移动或覆盖服务器上的文件。')
  if (effects.length) return effects.slice(0, 2).join(' ')
  return '可能修改服务器上的文件、服务或系统配置。'
}

/** Never relax another policy's denial/approval, nor apply server rules to unbound/local tools. */
export function serverToolDecision(
  name: string, args: unknown, binding: { remote: boolean; operations: boolean }, decision: PreToolDecision,
): PreToolDecision {
  if (decision.kind !== 'allow') return decision
  if ((name === 'remote_run' && binding.remote) || (name === 'server_exec' && binding.operations)) {
    const command = args && typeof args === 'object' && 'command' in args ? args.command : undefined
    return isServerQuery(command) ? decision : { kind: 'ask', reason: '这条远端命令可能修改文件、服务或系统状态，需要确认后执行。' }
  }
  if (name === 'remote_write' && binding.remote) return { kind: 'ask', reason: '在已选择的服务器写入文件。' }
  if (binding.operations) {
    const reasons: Record<string, string> = {
      server_deploy_apply: '将预览过的本地文件部署到当前会话关联的服务器。',
      server_deploy_directory_apply: '将预览过的本地目录部署到当前会话关联的服务器。',
      server_download_apply: '从当前会话关联的服务器取回预览过的文件。',
    }
    if (Object.hasOwn(reasons, name)) return { kind: 'ask', reason: reasons[name]! }
  }
  return decision
}
