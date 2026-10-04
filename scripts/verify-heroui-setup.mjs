import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const workspaceRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = workspaceRoot
const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'))
const stylesheet = readFileSync(resolve(workspaceRoot, 'src/styles.css'), 'utf8')
const tailwindHelperPath = resolve(workspaceRoot, 'src/ui/tailwind.ts')
const sourceRoot = resolve(workspaceRoot, 'src')
const rendererSourcePaths = readdirSync(sourceRoot, { recursive: true })
  .filter(path => typeof path === 'string' && path.endsWith('.tsx'))
const rendererSources = rendererSourcePaths
  .map(path => readFileSync(resolve(sourceRoot, path), 'utf8'))
  .join('\n')
const mcpConfigPath = resolve(repositoryRoot, '.codex/config.toml')
const skillPath = resolve(repositoryRoot, '.agents/skills/heroui-react/SKILL.md')
const requiredDependencies = ['@heroui/react', '@heroui/styles', 'react', 'react-dom', 'tailwindcss']
const missingDependencies = requiredDependencies.filter(name => !manifest.dependencies?.[name])

if (missingDependencies.length > 0) {
  throw new Error(`verify-heroui-setup: missing required dependencies: ${missingDependencies.join(', ')}`)
}

const tailwindImport = stylesheet.indexOf('@import "tailwindcss";')
const heroUiImport = stylesheet.indexOf('@import "@heroui/styles";')

if (tailwindImport === -1 || heroUiImport === -1 || tailwindImport > heroUiImport) {
  throw new Error('verify-heroui-setup: styles.css must import Tailwind CSS before HeroUI styles')
}

if (!rendererSources.includes("from '@heroui/react/")) {
  throw new Error('verify-heroui-setup: the Renderer must use HeroUI React components')
}

if (/^\s*\.[a-z_-][^{]*\{/imu.test(stylesheet)) {
  throw new Error('verify-heroui-setup: styles.css must not contain component class rules; colocate Tailwind utilities in JSX')
}

if (!existsSync(tailwindHelperPath)) {
  throw new Error('verify-heroui-setup: missing the Tailwind class-name helper')
}

const tailwindHelper = readFileSync(tailwindHelperPath, 'utf8')
if (tailwindHelper.includes('tailwindRecipes') || tailwindHelper.length > 2_000) {
  throw new Error('verify-heroui-setup: component styles must stay inline; tailwind.ts may only merge class names')
}

if (/\[(?:&_|\.dark_&)/u.test(rendererSources)) {
  throw new Error('verify-heroui-setup: descendant styling is forbidden; style each element or HeroUI slot directly')
}

for (const sourcePath of rendererSourcePaths) {
  const source = readFileSync(resolve(sourceRoot, sourcePath), 'utf8')
  const hasRawClassName = /className\s*=\s*(?:["'`]|\{\s*(?!tw\())/u.test(source)
  if (hasRawClassName) {
    throw new Error(`verify-heroui-setup: ${sourcePath} must route className values through tw()`)
  }
}

if (!existsSync(mcpConfigPath)) {
  throw new Error('verify-heroui-setup: missing project-scoped HeroUI MCP configuration')
}

const mcpConfig = readFileSync(mcpConfigPath, 'utf8')
if (!mcpConfig.includes('[mcp_servers.heroui-react]')
  || !mcpConfig.includes('command = "npx"')
  || !mcpConfig.includes('"@heroui/react-mcp@latest"')) {
  throw new Error('verify-heroui-setup: project MCP configuration must register @heroui/react-mcp')
}

if (!existsSync(skillPath)) {
  throw new Error('verify-heroui-setup: missing project-scoped HeroUI React skill')
}

process.stdout.write('verify-heroui-setup: HeroUI v3 uses colocated Tailwind utilities and a theme-only stylesheet\n')
