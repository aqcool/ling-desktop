import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workspaceRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(workspaceRoot, '..')
const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'))
const stylesheet = readFileSync(resolve(workspaceRoot, 'src/styles.css'), 'utf8')
const appSource = readFileSync(resolve(workspaceRoot, 'src/App.tsx'), 'utf8')
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

if (!appSource.includes("from '@heroui/react/")) {
  throw new Error('verify-heroui-setup: the Renderer must use HeroUI React components')
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

process.stdout.write('verify-heroui-setup: HeroUI v3 packages, styles, MCP configuration, and project skill are configured\n')
