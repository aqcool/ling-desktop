import { describe, expect, it } from 'vitest'
import { isServerQuery, serverCommandImpact, serverToolDecision } from '../src/host/server-command-policy.ts'

describe('server command policy', () => {
  it.each([
    'pwd', 'ls -lah /opt/1panel/apps/local', 'uname -a && uptime; free -h',
    'df -h | head -20', 'ps aux | grep nginx', 'sudo -n systemctl status nginx --no-pager',
    'systemctl is-active nginx', 'systemctl list-units --type=service --all',
    'journalctl -u nginx -n 100 --no-pager', 'journalctl --since "1 hour ago" -p err',
    'tail -n 100 /var/log/nginx/error.log 2>/dev/null', 'ls /srv 2>&1 | head -10',
    'find /srv -maxdepth 2 -type f -name "*.json" -print', "sed -n '1,120p' /srv/config",
    'cd /srv/app && git status --short', 'git --no-pager log -5 --oneline', 'git branch --show-current',
    'docker ps -a', 'docker compose -f compose.yml logs --tail 50', 'docker container ls',
    'ss -lntp', 'ip -br addr', 'ip route show', '/usr/bin/du -sh /srv', 'hostname -I',
    "printf '%s\\n' 'literal $(rm -rf /srv)'", "echo 'not; a command'", 'date -u +%FT%TZ',
    'ls /srv\n# inspect only\nstat /srv/app',
  ])('runs ordinary inspections directly: %s', command => { expect(isServerQuery(command)).toBe(true) })

  it.each([
    '', 'rm -rf /srv/app', 'systemctl restart nginx', 'sudo reboot', 'chmod -R 777 /srv',
    'ls /srv && rm -rf /srv', 'pwd; touch /tmp/proof', 'cat /etc/passwd > /srv/users',
    'echo bad >/srv/config', 'cat /srv/file | tee /srv/copy', 'ls &', 'ls | sh',
    'ls $(touch /tmp/proof)', 'echo "`touch /tmp/proof`"', 'sh -c "ls"', 'bash ./deploy.sh',
    './ls', '/tmp/ls', 'find /srv -delete', 'find -- /srv -delete', 'find /srv -exec rm {} \\;', 'find /srv -fprint /tmp/list',
    'sed -i s/a/b/ /srv/file', 'sed -n "1p;w /tmp/out" /srv/file', 'sort -o /tmp/out /srv/file',
    'journalctl --rotate', 'journalctl -b --vacuum-time=1d', 'journalctl --vacuum-size=1M',
    'ss -K dst 127.0.0.1', 'ip link set eth0 down', 'hostname replacement', 'date 092912302026',
    'git branch new-branch', 'git branch -D main', 'git diff --output=/tmp/file', 'git diff --out=/tmp/file',
    'git -c alias.inspect="!rm -rf /srv" inspect', 'git log --exec=evil', 'docker compose down',
    'docker system prune', 'docker exec app sh', 'sudo -E ls', 'sudo -u root rm file',
    'export A=1; ls', 'ls \u0000', 'ls &&', 'printf -v PATH value', 'ls\n(reboot)',
  ])('requires approval for changes or unknown syntax: %s', command => { expect(isServerQuery(command)).toBe(false) })

  it('preserves upstream decisions and only affects bound remote tools', () => {
    const allow = { kind: 'allow' } as const
    const ask = { kind: 'ask', reason: 'Another policy requires review' } as const
    expect(serverToolDecision('server_exec', { command: 'pwd' }, { remote: false, operations: true }, allow)).toBe(allow)
    expect(serverToolDecision('remote_run', { command: 'pwd' }, { remote: true, operations: false }, ask)).toBe(ask)
    expect(serverToolDecision('server_exec', { command: 'rm file' }, { remote: false, operations: false }, allow)).toBe(allow)
    for (const name of ['server_exec', 'remote_run', 'remote_write', 'server_deploy_apply', 'server_deploy_directory_apply', 'server_download_apply']) {
      expect(serverToolDecision(name, { command: 'rm file' }, { remote: true, operations: true }, allow).kind).toBe('ask')
    }
  })

  it('describes the side effect after read-only prechecks', () => {
    expect(serverCommandImpact('ls /srv && rm /srv/old')).toContain('删除')
    expect(serverCommandImpact('mkdir /srv/new && rm -rf /srv/old && systemctl restart app')).toMatch(/删除.*中断/)
    expect(serverCommandImpact('systemctl restart nginx')).toContain('中断')
    expect(serverCommandImpact('chmod 600 /srv/config')).toContain('权限')
    expect(serverCommandImpact('sh deploy.sh')).toContain('可能修改')
  })
  it('uses the session modes and preserves independent denials', () => {
    const binding = { remote: true, operations: true, cwd: '/srv/project' }
    const allow = { kind: 'allow' } as const
    const ask = { kind: 'ask', reason: 'another guard' } as const
    const deny = { kind: 'deny', reason: 'another guard' } as const
    for (const name of ['server_exec', 'remote_run', 'remote_write', 'server_deploy_apply', 'server_deploy_directory_apply', 'server_download_apply']) {
      expect(serverToolDecision(name, { command: 'systemctl restart app' }, { ...binding, mode: 'danger-full-access' }, allow)).toBe(allow)
      expect(serverToolDecision(name, { command: 'systemctl restart app' }, { ...binding, mode: 'read-only' }, ask).kind).toBe('deny')
      expect(serverToolDecision(name, {}, { ...binding, mode: 'danger-full-access' }, deny)).toBe(deny)
    }
    expect(serverToolDecision('server_exec', { command: 'pwd' }, { ...binding, mode: 'read-only' }, allow)).toBe(allow)
    expect(serverToolDecision('remote_write', { path: 'src/app.ts' }, { ...binding, mode: 'workspace-write' }, allow)).toBe(allow)
    expect(serverToolDecision('remote_write', { path: '../outside.txt' }, { ...binding, mode: 'workspace-write' }, allow).kind).toBe('ask')
    expect(serverToolDecision('remote_write', { path: '/srv/project-other/app.ts' }, { ...binding, mode: 'workspace-write' }, allow).kind).toBe('ask')
  })

})
