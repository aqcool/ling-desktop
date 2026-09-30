import { defineConfig } from 'vitest/config'

// The nested Host is a separate workspace with its own runtime fixtures.
export default defineConfig({ test: { include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'] } })
