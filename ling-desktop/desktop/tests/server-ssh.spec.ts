import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { directoryCommand, quoteRemote, sshArguments, sshFailureMessage } from '../src/server-ssh.ts'

describe('SSH command boundary', () => {
  it('accepts a host alias only as one operand after fixed non-interactive options', () => {
    const args = sshArguments({ alias: 'ling-staging' }, 'pwd -P')
    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('StrictHostKeyChecking=yes')
    expect(args).toContain('ForwardAgent=no')
    expect(args.slice(-2)).toEqual(['ling-staging', 'pwd -P'])
    expect(sshArguments({ alias: '114.55.34.58', user: 'deploy', port: 2222 }, 'pwd -P').slice(-6)).toEqual(['-l', 'deploy', '-p', '2222', '114.55.34.58', 'pwd -P'])
    expect(() => sshArguments({ alias: '-oProxyCommand=bad' }, 'pwd -P')).toThrow()
    expect(() => sshArguments({ alias: 'good host' }, 'pwd -P')).toThrow()
    expect(() => sshArguments({ alias: 'good', user: '-oProxyCommand=bad' }, 'pwd -P')).toThrow()
    expect(() => sshArguments({ alias: 'good', port: 99999 }, 'pwd -P')).toThrow()
  })

  it('turns SSH failures into actionable messages without forwarding diagnostics', () => {
    expect(sshFailureMessage('Permission denied (publickey).')).toContain('登录用户')
    expect(sshFailureMessage('debug1: Authentications that can continue: publickey,password\nPermission denied (publickey,password).')).toContain('没有向服务器提供可用公钥')
    expect(sshFailureMessage('debug1: Authentications that can continue: publickey,password\ndebug1: Offering public key: /redacted\nPermission denied (publickey,password).')).not.toContain('没有向服务器提供可用公钥')
    expect(sshFailureMessage('Host key verification failed.')).toContain('主机指纹')
    expect(sshFailureMessage('ssh: connect to host 114.55.34.58 port 22: Connection refused')).toContain('SSH 端口')
    expect(sshFailureMessage('ssh: Could not resolve hostname private.internal: Name or service not known')).not.toContain('private.internal')
  })

  it('quotes remote directory names as a single shell argument', () => {
    expect(quoteRemote("/home/a'; touch /tmp/owned; echo '")).toBe("'/home/a'\\''; touch /tmp/owned; echo '\\'''")
    expect(() => quoteRemote('/tmp/\0bad')).toThrow()
  })

  it('lists immediate directories without evaluating path text as a command', () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-ssh-quote-'))
    try {
      const parent = join(root, "dir'; touch exploit; echo '")
      mkdirSync(parent)
      mkdirSync(join(parent, 'visible'))
      mkdirSync(join(parent, '.hidden'))
      mkdirSync(join(parent, 'visible', 'nested'))
      const output = execFileSync('sh', ['-c', directoryCommand(parent)]).toString('utf8').split('\0').slice(1).filter(Boolean)
      expect(output.sort()).toEqual([join(parent, '.hidden'), join(parent, 'visible')].sort())
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
