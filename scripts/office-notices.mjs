import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Ship the notices of Office dependencies alongside the renderer in packaged apps.
const destination = new URL('../dist/licenses/office/', import.meta.url)
const seeds = ['@univerjs/core', '@univerjs/presets', '@univerjs/preset-sheets-core', '@univerjs/preset-docs-core', '@univerjs/preset-docs-drawing', '@univerjs/slides', '@univerjs/slides-ui', '@univerjs/drawing', 'exceljs', 'fflate', 'rxjs']
const seen = new Set(), packages = []
await mkdir(destination, { recursive: true })
async function collect(name, require) {
  if (name.startsWith('@univerjs-pro/')) throw new Error('Office preview must not bundle Univer Pro.')
  // ExcelJS's Node streaming archive dependencies are absent from its browser
  // build, which is the only entry bundled into the Office viewer.
  if (['binary', 'chainsaw', 'buffers'].includes(name)) return
  let manifestPath
  try { manifestPath = require.resolve(`${name}/package.json`) }
  catch {
    try { const entry = require.resolve(name); let directory = dirname(entry)
      for (;;) { const candidate = join(directory, 'package.json'); try { const data = JSON.parse(await readFile(candidate, 'utf8')); if (data.name === name) { manifestPath = candidate; break } } catch {}
        const parent = dirname(directory); if (parent === directory) break; directory = parent }
    } catch {}
  }
  if (!manifestPath) throw new Error(`Missing Office dependency metadata: ${name}`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), key = `${manifest.name}@${manifest.version}`
  if (seen.has(key)) return
  seen.add(key)
  const directory = dirname(manifestPath), notices = []
  for (const file of await readdir(directory)) if (/^(?:licen[cs]e|notice|copying)(?:[.\-_].*)?$/i.test(file)) {
    try { notices.push(`--- ${file} ---\n${await readFile(join(directory, file), 'utf8')}`) } catch {}
  }
  // A few packages (e.g. ot-json1) carry the full license in their README.
  if (!notices.length) for (const file of await readdir(directory)) if (/^readme(?:\..*)?$/i.test(file)) {
    const source = await readFile(join(directory, file), 'utf8')
    const section = source.match(/^#{1,3}\s+licen[cs]e\s*\r?\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im)?.[1]
    if (section && /permission to use|permission is hereby granted|licensed under/i.test(section)) notices.push(`--- ${file}: License ---\n${section.replaceAll('&lt;', '<').replaceAll('&gt;', '>').trim()}`)
  }
  // Some Univer presets/protocol packages omit LICENSE from their npm file list.
  // They share the repository's Apache license and DreamNum copyright notice.
  if (!notices.length && name.startsWith('@univerjs/') && manifest.license === 'Apache-2.0') notices.push(`Copyright 2023-present DreamNum Co., Ltd.\n\n${await readFile(new URL('../node_modules/@univerjs/core/LICENSE', import.meta.url), 'utf8')}`)
  // franc-min's npm file list omits the monorepo license linked from its README.
  if (!notices.length && name === 'franc-min' && manifest.license === 'MIT') notices.push(`Source: https://github.com/wooorm/franc/blob/main/license\n\n${await readFile(new URL('./licenses/franc-min-MIT.txt', import.meta.url), 'utf8')}`)
  if (!notices.length && name === 'react-remove-scroll-bar' && manifest.license === 'MIT') notices.push(`Source: https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE\n\n${await readFile(new URL('./licenses/react-remove-scroll-bar-MIT.txt', import.meta.url), 'utf8')}`)
  if (!notices.length && name === 'saxes' && manifest.license === 'ISC') notices.push(`Source: https://github.com/lddubeau/saxes/blob/v5.0.1/LICENSE\n\n${await readFile(new URL('./licenses/saxes-ISC.txt', import.meta.url), 'utf8')}`)
  packages.push({ name: manifest.name, version: manifest.version, license: manifest.license ?? 'See included notice', repository: manifest.repository })
  if (notices.length) await writeFile(new URL(`${key.replaceAll('/', '__')}.txt`, destination), notices.join('\n\n'))
  else throw new Error(`Missing Office dependency license: ${key}`)
  const local = createRequire(manifestPath)
  for (const dependency of Object.keys(manifest.dependencies ?? {})) await collect(dependency, local)
}
for (const name of seeds) await collect(name, createRequire(import.meta.url))
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
await writeFile(new URL('packages.json', destination), JSON.stringify(packages, null, 2) + '\n')
await writeFile(new URL('README.txt', destination), 'LING Office preview uses Univer open-source components under Apache-2.0, ExcelJS under MIT, and fflate under MIT.\nNo Univer Pro packages are included. These notices accompany the bundled dependencies.\n')
console.log(`Office notices: ${packages.length} dependency licenses`)
