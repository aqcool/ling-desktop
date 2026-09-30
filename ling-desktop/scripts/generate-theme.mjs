import { readFileSync, writeFileSync } from 'node:fs'
import { themeStylesheet } from '../src/theme/tokens.ts'
const file = new URL('../src/theme/generated.css', import.meta.url)
const css = '/* Generated from theme/tokens.ts. Run node scripts/generate-theme.mjs. */\n' + themeStylesheet() + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== css) throw new Error('Theme CSS is stale; run node scripts/generate-theme.mjs')
} else writeFileSync(file, css)
