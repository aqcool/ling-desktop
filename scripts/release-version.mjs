/** Keep LING's two workspace versions and release tags in agreement. */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export function releaseVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)
    || value.split('-').slice(1).join('-').split('.').some(part => /^0\d+$/.test(part))) {
    throw new Error('Use a SemVer version, for example 0.1.0-beta.1 (without the tag prefix)')
  }
  return value
}
export async function updateVersion(root, value, check = false) {
  const version = releaseVersion(value)
  const paths = ['package.json', 'desktop/package.json'].map(path => resolve(root, path))
  const packages = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))))
  if (packages[0].version !== packages[1].version) throw new Error('Renderer and Host versions differ')
  if (check) {
    if (packages.some(pkg => pkg.version !== version)) throw new Error('Release tag differs from the package versions')
    return
  }
  for (let i = 0; i < paths.length; i++) {
    const temporary = `${paths[i]}.release-tmp`
    await writeFile(temporary, `${JSON.stringify({ ...packages[i], version }, null, 2)}\n`)
    await rename(temporary, paths[i])
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), check = args[0] === '--check'
  if (args.length !== (check ? 2 : 1)) throw new Error('Usage: release-version.mjs [--check] VERSION')
  await updateVersion(resolve(dirname(fileURLToPath(import.meta.url)), '..'), args[check ? 1 : 0], check)
  console.log(`LING version verified: ${args[check ? 1 : 0]}`)
}
