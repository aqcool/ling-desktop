import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { realpath, stat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { LingWorkspaceToolRequest, LingWorkspaceTools } from 'ling-desktop/runtime'

const execute = promisify(execFile)

export async function readApplicationIcon(applicationPath: string): Promise<string> {
  const { stdout } = await execute('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', join(applicationPath, 'Contents/Info.plist')], { timeout: 3000 })
  const name = basename(stdout.trim())
  const iconPath = join(applicationPath, 'Contents/Resources', name.endsWith('.icns') ? name : `${name}.icns`)
  const directory = await mkdtemp(join(tmpdir(), 'ling-app-icon-'))
  try {
    const output = join(directory, 'icon.png')
    await execute('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '32', iconPath, '--out', output], { timeout: 5000 })
    return `data:image/png;base64,${(await readFile(output)).toString('base64')}`
  } finally { await rm(directory, { recursive: true, force: true }) }
}
const applicationDefinitions = [
  { id: 'finder', name: '访达', paths: ['/System/Library/CoreServices/Finder.app'] },
  { id: 'vscode', name: 'VS Code', paths: ['/Applications/Visual Studio Code.app'] },
  { id: 'idea', name: 'IntelliJ IDEA', paths: ['/Applications/IntelliJ IDEA.app', '/Applications/IntelliJ IDEA CE.app'] },
  { id: 'terminal', name: '终端', paths: ['/System/Applications/Utilities/Terminal.app'] },
  { id: 'warp', name: 'Warp', paths: ['/Applications/Warp.app'] },
] as const

interface Run {
  id: string; name: string; command: string; cwd: string; output: string
  running: boolean; exitCode?: number | null; process: ChildProcess
}

export class WorkspaceTools {
  private readonly runs = new Map<string, Run>()
  private applications?: Promise<{ id: string; name: string; path?: string; icon?: string }[]>
  constructor(private readonly native: {
    icon(path: string): Promise<string>
    openPath(path: string): Promise<string>
  }) {}

  private getApplications() {
    this.applications ??= (async () => {
      if (process.platform !== 'darwin') return [{ id: 'files', name: process.platform === 'win32' ? '文件资源管理器' : '文件' }]
      const found = applicationDefinitions.flatMap(definition => {
        const path = definition.paths.flatMap(path => [path, join(homedir(), path.slice(1))]).find(existsSync)
        return path ? [{ id: definition.id, name: definition.name, path }] : []
      })
      return Promise.all(found.map(async application => ({ ...application, icon: await this.native.icon(application.path).catch(() => '') })))
    })()
    return this.applications
  }

  async handle(path: unknown, request: LingWorkspaceToolRequest): Promise<LingWorkspaceTools> {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('工作区路径无效。')
    const cwd = await realpath(path)
    if (!(await stat(cwd)).isDirectory()) throw new Error('工作区目录已不存在。')
    const applications = await this.getApplications()
    if (request.type === 'open') {
      const application = applications.find(item => item.id === request.applicationId)
      if (!application) throw new Error('未找到该应用，请确认已经安装。')
      if (application.path) await execute('/usr/bin/open', ['-a', application.path, cwd], { timeout: 10000 })
      else {
        const error = await this.native.openPath(cwd)
        if (error) throw new Error(error)
      }
    } else if (request.type === 'run') {
      if (!request.command?.trim() || !request.name?.trim() || request.command.length > 16000 || request.name.length > 120) throw new Error('请输入有效的名称和命令。')
      if ([...this.runs.values()].filter(run => run.running && run.cwd === cwd).length >= 8) throw new Error('当前工作区运行中的命令过多，请先停止部分命令。')
      // Only an explicit Run request executes shell text; inspection never runs project scripts.
      const child = process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${request.command}"`], { cwd, windowsHide: true, windowsVerbatimArguments: true })
        : spawn(process.env.SHELL || '/bin/sh', ['-lc', request.command], { cwd, detached: true, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' } })
      const run: Run = { id: randomUUID(), name: request.name, command: request.command, cwd, output: '', running: true, process: child }
      this.runs.set(run.id, run)
      const append = (data: string) => { run.output = (run.output + data).slice(-200000) }
      child.stdout?.setEncoding('utf8').on('data', append)
      child.stderr?.setEncoding('utf8').on('data', append)
      child.on('error', error => { append(`\n${error.message}\n`); run.running = false; run.exitCode = -1 })
      child.on('close', code => { run.running = false; run.exitCode = code })
      // Keep bounded output history per workspace; running processes are never evicted.
      const finished = [...this.runs.values()].filter(item => item.cwd === cwd && !item.running)
      for (const old of finished.slice(0, Math.max(0, finished.length - 15))) this.runs.delete(old.id)
    } else if (request.type === 'stop') {
      const run = this.runs.get(request.runId)
      if (!run || run.cwd !== cwd) throw new Error('未找到运行中的命令。')
      this.stop(run)
    } else if (request.type !== 'inspect') throw new Error('无效的工作区操作。')
    return {
      applications: applications.map(({ id, name, icon }) => ({ id, name, ...(icon ? { icon } : {}) })),
      runs: [...this.runs.values()].filter(run => run.cwd === cwd).map(({ id, name, command, output, running, exitCode }) => ({ id, name, command, output, running, exitCode })),
    }
  }

  private stop(run: Run) {
    if (!run.running || !run.process.pid) return
    if (process.platform === 'win32') {
      void execute('taskkill', ['/pid', String(run.process.pid), '/t', '/f']).catch(() => {})
    } else {
      try { process.kill(-run.process.pid, 'SIGTERM') } catch { run.process.kill('SIGTERM') }
      const timer = setTimeout(() => {
        if (run.running && run.process.pid) { try { process.kill(-run.process.pid, 'SIGKILL') } catch {} }
      }, 1500)
      timer.unref()
    }
  }

  dispose() { for (const run of this.runs.values()) this.stop(run) }
}
