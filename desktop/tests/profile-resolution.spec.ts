import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createProfileResolutionGeneration } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

it('finds transitive plugins behind pnpm links without writing the user profile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ling-profile-resolution-'))
  try {
    const home = join(root, 'home')
    const app = join(root, 'app')
    const modules = join(app, 'node_modules')
    const bundle = join(modules, '.pnpm', 'bundle', 'node_modules', 'fixture-bundle')
    const plugin = join(modules, '.pnpm', 'plugin', 'node_modules', 'fixture-plugin')
    const helper = join(modules, '.pnpm', 'helper', 'node_modules', 'fixture-helper')
    const manifest = (directory: string, name: string, dependencies: Record<string, string> = {}) => {
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies }))
    }
    manifest(app, 'fixture-app', { 'fixture-bundle': '1.0.0' })
    manifest(bundle, 'fixture-bundle', { 'fixture-plugin': '1.0.0' })
    manifest(plugin, 'fixture-plugin', { 'fixture-helper': '1.0.0' })
    manifest(helper, 'fixture-helper')
    symlinkSync(bundle, join(modules, 'fixture-bundle'), 'junction')
    symlinkSync(plugin, join(dirname(bundle), 'fixture-plugin'), 'junction')
    symlinkSync(helper, join(dirname(plugin), 'fixture-helper'), 'junction')

    const generation = await createProfileResolutionGeneration({ installAnchor: join(app, 'package.json'), home })
    const entries = new Map(generation.entries.map(entry => [entry.name, entry]))
    expect([...entries.keys()].sort()).toEqual(['fixture-app', 'fixture-bundle', 'fixture-helper', 'fixture-plugin'])
    expect(entries.get('fixture-plugin')?.packageDir).toBe(realpathSync(plugin))
    expect(entries.get('fixture-helper')?.declarer).toBe(join(realpathSync(plugin), 'package.json'))
    expect(existsSync(home)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
