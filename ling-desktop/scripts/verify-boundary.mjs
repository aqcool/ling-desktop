import { readdirSync, readFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(root, 'src')
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts'])
const forbiddenUpstreamUiPackages = [
  '@deepseek-ai/dsh-client-ui-',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-web-frontend',
]

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return sourceExtensions.has(extname(entry.name)) ? [path] : []
  })
}

const files = sourceFiles(sourceRoot)
if (files.length === 0) throw new Error('verify-boundary: LING Desktop must contain a source entry point')

const violations = files.flatMap(path => {
  const source = readFileSync(path, 'utf8')
  return forbiddenUpstreamUiPackages
    .filter(packageName => source.includes(packageName))
    .map(packageName => `${relative(root, path)} imports or references ${packageName}`)
})

if (violations.length > 0) {
  throw new Error(`verify-boundary: LING Renderer must not depend on upstream UI packages:\n${violations.join('\n')}`)
}

process.stdout.write(`verify-boundary: ${String(files.length)} LING source file(s) are independent of upstream DSH UI packages\n`)
