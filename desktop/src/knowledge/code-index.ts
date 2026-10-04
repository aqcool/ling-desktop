import { createRequire } from 'node:module'
import { dirname, extname, posix, relative, resolve, sep } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import type { Parser as TreeSitterParser, Language as TreeSitterLanguage, Node } from '@vscode/tree-sitter-wasm'
import type { KnowledgeNode, KnowledgeEdge, KnowledgeSource } from 'ling-desktop/runtime'
import type { IndexedFile } from './store.ts'

const execute = promisify(execFile)
// This package ships UMD/CommonJS; Electron's ESM loader cannot infer named exports.
const require = createRequire(import.meta.url)
const { Parser, Language } = require('@vscode/tree-sitter-wasm') as typeof import('@vscode/tree-sitter-wasm')
const { rgPath } = require('@vscode/ripgrep') as typeof import('@vscode/ripgrep')
const wasm = dirname(require.resolve('@vscode/tree-sitter-wasm'))
let initialized: Promise<void> | undefined
const languages = new Map<string, Promise<TreeSitterLanguage>>()
const grammar: Record<string, string> = { '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.go': 'go', '.py': 'python', '.rs': 'rust', '.java': 'java' }
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
export function eligiblePath(path: string): boolean {
  return !path.split(/[\\/]/).some(part => /^(?:node_modules|vendor|dist|build|coverage|\.ssh|\.aws|\.git|\.yarn|\.next|\.DS_Store|\.env(?:\..*)?)$/.test(part)) && !/(?:^|\/)(?:(?:auth|credentials|secrets|tokens)\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.(?:pem|key|p12|pfx))$/.test(path)
    && /\.(?:tsx?|jsx?|mjs|cjs|go|py|rs|java|md|json|ya?ml|toml|sql|css|html)$/.test(path)
}
/** Local adapter. Realpath containment is checked again for every read; symlinks cannot escape. */
export async function readCode(root: string, path: string, signal?: AbortSignal): Promise<string> {
  if (!eligiblePath(path) || path.includes('\0')) throw new Error('文件不在可索引范围内。')
  const base = await realpath(root), target = await realpath(resolve(base, path)), rel = relative(base, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(base, rel) !== target) throw new Error('文件不属于此工作区。')
  const info = await stat(target)
  if (!info.isFile() || info.size > 512 * 1024) throw new Error('仅索引 512 KB 以内的文本文件。')
  const text = await readFile(target, { encoding: 'utf8', signal })
  if (text.includes('\0')) throw new Error('此文件不是文本。')
  return text
}
const declarations = new Set(['function_declaration', 'function_definition', 'method_definition', 'method_declaration', 'class_declaration', 'class_definition', 'interface_declaration', 'type_alias_declaration', 'type_spec', 'struct_item', 'function_item', 'impl_item', 'enum_item'])
export async function parseCode(path: string, body: string, commit?: string): Promise<IndexedFile> {
  const hash = sha256(body)
  const source: KnowledgeSource = { kind: 'code', label: path, path, line: 1, hash, ...(commit ? { commit } : {}) }
  const fileId = `file:${path}`
  const nodes: KnowledgeNode[] = [{ id: fileId, label: posix.basename(path), kind: 'file', source }]
  const edges: KnowledgeEdge[] = [], imports: string[] = []
  const languageName = grammar[extname(path)]
  if (!languageName) return { path, body, hash, commit, nodes, edges, imports }
  initialized ??= Parser.init({ locateFile: file => resolve(wasm, file) })
  await initialized
  let loading = languages.get(languageName)
  if (!loading) { loading = Language.load(resolve(wasm, `tree-sitter-${languageName}.wasm`)); languages.set(languageName, loading) }
  const parser = new Parser()
  let tree: ReturnType<TreeSitterParser['parse']>
  try {
    parser.setLanguage(await loading)
    tree = parser.parse(body)
    if (!tree) throw new Error('代码解析被中断。')
    const functions = new Map<string, KnowledgeNode[]>()
    const calls: { owner: string; name: string; line: number }[] = []
    const walk = (node: Node, owner = fileId) => {
      let current = owner
      const name = node.childForFieldName('name')
      // Arrow functions inherit their variable name; lexical identity includes line/column.
      if (declarations.has(node.type) && name || node.type === 'variable_declarator' && ['arrow_function', 'function_expression'].includes(node.childForFieldName('value')?.type ?? '')) {
        const label = name?.text ?? node.childForFieldName('name')?.text
        if (label) {
          const id = `symbol:${path}:${node.startPosition.row + 1}:${node.startPosition.column}:${label}`
          const symbol: KnowledgeNode = { id, label, kind: 'symbol', parent: owner, source: { ...source, line: (name ?? node).startPosition.row + 1, column: (name ?? node).startPosition.column + 1, endLine: node.endPosition.row + 1 } }
          nodes.push(symbol); edges.push({ id: `contains:${id}`, source: owner, target: id, kind: 'contains', evidence: 'syntax' }); current = id
          functions.set(label, [...(functions.get(label) ?? []), symbol])
        }
      }
      if (node.type === 'import_statement' || node.type === 'import_spec' || node.type === 'import_from_statement') {
        const value = node.childForFieldName('source') ?? node.childForFieldName('path') ?? node.childForFieldName('module_name')
        if (value) imports.push(value.text.replace(/^['"`]|['"`]$/g, ''))
      }
      if (node.type === 'call_expression') {
        const name = node.childForFieldName('function')
        if (name?.type === 'identifier') calls.push({ owner: current, name: name.text, line: node.startPosition.row + 1 })
      }
      for (const child of node.namedChildren) if (child) walk(child, current)
    }
    walk(tree.rootNode)
    for (const call of calls) {
      const candidates = functions.get(call.name)
      if (candidates?.length === 1 && candidates[0]) edges.push({ id: `call:${call.owner}:${call.line}:${candidates[0].id}`, source: call.owner, target: candidates[0].id, kind: 'calls', evidence: 'syntax' })
    }
    tree.delete()
  } finally { parser.delete() }
  return { path, body, hash, commit, nodes, edges, imports }
}
export async function indexLocalWorkspace(root: string, previous: IndexedFile[], signal: AbortSignal): Promise<IndexedFile[]> {
  let output: string
  try { output = (await execute(rgPath, ['--files', '--hidden', '-g', '!.git', '-g', '!node_modules', '-g', '!vendor'], { cwd: root, signal, maxBuffer: 8 * 1024 * 1024 })).stdout }
  catch (error) { if (signal.aborted) throw error; output = (await execute('git', ['ls-files', '-c', '-o', '--exclude-standard'], { cwd: root, signal, maxBuffer: 8 * 1024 * 1024 })).stdout }
  const paths = [...new Set(output.split('\n').filter(eligiblePath))].sort()
  if (paths.length > 20000) throw new Error('工作区超过 20,000 个可索引文件，请缩小项目范围。')
  let commit: string | undefined
  try { commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root, signal })).stdout.trim() } catch { signal.throwIfAborted() }
  const old = new Map(previous.map(file => [file.path, file])), files: IndexedFile[] = []
  let bytes = 0
  for (const path of paths) {
    signal.throwIfAborted()
    let body: string
    try { body = await readCode(root, path, signal) } catch (error) {
      signal.throwIfAborted()
      // Known unsupported files can be skipped; I/O failures must not mark a partial index complete.
      if (error instanceof Error && /(?:不在可索引|不属于此|512 KB|不是文本)/.test(error.message)) continue
      throw error
    }
    bytes += Buffer.byteLength(body)
    if (bytes > 128*1024*1024) throw new Error('工作区文本超过 128 MB 索引预算，请缩小项目范围。')
    const previous = old.get(path)
    files.push(previous?.hash === sha256(body) && previous.commit === commit ? previous : await parseCode(path, body, commit))
    // WASM/SQLite work yields between files rather than freezing the host for a whole repository.
    await new Promise<void>(done => setImmediate(done))
  }
  return files
}
export function codeGraph(files: IndexedFile[]): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const nodes: KnowledgeNode[] = [], edges: KnowledgeEdge[] = [], paths = new Set(files.map(file => file.path)), modules = new Set<string>()
  for (const file of files) {
    const module = file.path.includes('/') ? file.path.split('/')[0]! : '根目录'
    if (!modules.has(module)) { modules.add(module); nodes.push({ id: `module:${module}`, kind: 'module', label: module }) }
    nodes.push(...file.nodes.map(node => node.kind === 'file' ? { ...node, parent: `module:${module}` } : node))
    edges.push({ id: `module-file:${file.path}`, source: `module:${module}`, target: `file:${file.path}`, kind: 'contains', evidence: 'syntax' }, ...file.edges)
    for (const specifier of file.imports) {
      if (!specifier.startsWith('.')) continue
      const base = posix.normalize(posix.join(posix.dirname(file.path), specifier))
      const target = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.js`].find(path => paths.has(path))
      if (target) edges.push({ id: `import:${file.path}:${target}`, source: `file:${file.path}`, target: `file:${target}`, kind: 'imports', evidence: 'syntax' })
    }
  }
  return { nodes, edges: [...new Map(edges.map(edge => [edge.id, edge])).values()] }
}

/** Literal, bounded search over the live workspace; FTS remains an independent retriever. */
export async function searchLocalCode(root: string, query: string, signal?: AbortSignal): Promise<import('ling-desktop/runtime').KnowledgeHit[]> {
  let output: string
  try {
    output = (await execute(rgPath, ['--json', '--fixed-strings', '--ignore-case', '--hidden', '--max-count', '3', '--glob', '!.git/**', '--glob', '!node_modules/**', '--glob', '!vendor/**', '--glob', '!dist/**', '--glob', '!build/**', '--', query, '.'], { cwd: root, signal, maxBuffer: 4 * 1024 * 1024 })).stdout
  } catch (error) {
    signal?.throwIfAborted()
    // No matches, unavailable rg, or excessive results fall back to the local FTS index.
    if (error && typeof error === 'object' && 'code' in error && ['ENOENT',1,'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error.code as string | number)) return []
    throw error
  }
  const hits: import('ling-desktop/runtime').KnowledgeHit[] = [], seen = new Set<string>()
  for (const line of output.split('\n')) {
    if (!line) continue
    const record = JSON.parse(line) as { type: string; data: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } }
    const path = record.data.path?.text?.replace(/^\.\//, '')
    if (record.type !== 'match' || !path || !eligiblePath(path) || seen.has(path)) continue
    let body: string
    try { body = await readCode(root, path, signal) } catch { signal?.throwIfAborted(); continue }
    seen.add(path)
    hits.push({ id: `code:${path}`, kind: 'code', title: path, snippet: record.data.lines?.text?.slice(0,320) ?? '', source: { kind: 'code', label: path, path, line: record.data.line_number ?? 1, hash: sha256(body) } })
    if (hits.length >= 30) break
  }
  return hits
}
