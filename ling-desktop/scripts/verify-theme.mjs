import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../src')
const violations = []
for (const path of readdirSync(root, { recursive: true }).filter(path => path.endsWith('.tsx'))) {
  const source = readFileSync(resolve(root, path), 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Provider artwork retains its brand colors; workspace swatches are user data,
      // not styling utilities. No entire application surface is exempted.
      const rawColor = path !== 'ui/ProviderIcon.tsx' && /(?:\[(?:color|background|border[^:]*|box-shadow|--[\w-]+):[^\]]*|(?:bg|text|border[^\s]*|ring|shadow)-\[)(?:#[\da-fA-F]{3,8}\b|rgba?\()/u.test(node.text)
      const rawMetric = /(?:text-\[|\[font-size:|rounded-\[|\[border-radius:)[\d.]+(?:px|rem)\]/u.test(node.text)
      const colorUtility = /(?:^|\s|:)(?:bg|text|border|ring)-(?:white|black|(?:gray|slate|zinc|neutral|stone|red|amber|green|blue|purple|orange|yellow|rose)-\d)/u.test(node.text)
      if (rawColor || rawMetric || colorUtility) violations.push(`${path}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
}
if (violations.length) throw new Error(`Use semantic theme tokens, not local colors or type/radius values:\n${violations.join('\n')}`)
console.log('verify-theme: Renderer appearance uses shared semantic colors, type and radius tokens')
