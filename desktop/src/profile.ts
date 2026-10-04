import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initProfile, loadProfileDirectory, PROFILE_TEMPLATES, type Profile } from '@deepseek-ai/dsh-app-boot'

export const LING_HOST_PACKAGE = fileURLToPath(new URL('../package.json', import.meta.url))
const BUNDLES = [...PROFILE_TEMPLATES.web!.bundles, 'ling-desktop-host']

export function profileDirectory(home: string): string {
  return join(home, 'profiles', 'default')
}

export function ensureLingProfile(home: string): string {
  const directory = profileDirectory(home)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  initProfile(directory, BUNDLES)
  return directory
}

export function loadLingProfile(directory: string, home: string, anchor = LING_HOST_PACKAGE): Profile {
  if (resolve(directory) !== resolve(profileDirectory(home))) throw new Error('Profile is outside the LING home')
  const modules = join(home, 'profiles', 'node_modules')
  mkdirSync(modules, { recursive: true, mode: 0o700 })
  const link = join(modules, 'ling-desktop-host')
  const target = realpathSync(dirname(anchor))
  const existing = lstatSync(link, { throwIfNoEntry: false })
  if (existing && !existing.isSymbolicLink()) throw new Error('LING bundle path is occupied')
  if (existing && resolve(modules, readlinkSync(link)) !== target) unlinkSync(link)
  if (!existsSync(link)) symlinkSync(target, link, 'junction')
  const profile = loadProfileDirectory('ling-desktop-host', directory, anchor)
  if (!profile.layers.some(layer => layer.packageName === 'ling-desktop-host')) {
    throw new Error('LING host bundle is missing from the profile')
  }
  return profile
}
