import type { IndexedFile } from './store.ts'

const budget = 60000
const moduleOf = (path: string) => path.includes('/') ? path.split('/').slice(0, 2).join('/') : '(root)'
const priority = (file: IndexedFile) => /(?:^|\/)(?:readme[^/]*|package\.json|cargo\.toml|go\.mod|main\.[^/]+|index\.[^/]+|app\.[^/]+)$/i.test(file.path) ? 0 : 1

/** Keep entry points and distribute the remaining reading budget across modules. */
export function wikiInventory(files: IndexedFile[]) {
  const groups = new Map<string, IndexedFile[]>()
  for (const file of [...files].sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path))) {
    const key = moduleOf(file.path)
    const group = groups.get(key) ?? []
    group.push(file)
    groups.set(key, group)
  }
  const modules = [...groups].map(([path, members]) => ({ path, files: members.length }))
  const selected: { path: string; imports: string[]; symbols: string[] }[] = []
  // Reserve space for coverage metadata; no path or symbol is cut in half.
  let remaining = budget - Math.min(12000, JSON.stringify(modules).length) - 1000
  for (let round = 0; ; round++) {
    let found = false
    for (const members of groups.values()) {
      const file = members[round]
      if (!file) continue
      found = true
      const item = {
        path: file.path,
        imports: file.imports.slice(0, 8),
        symbols: file.nodes.filter(node => node.kind === 'symbol').slice(0, 8).map(node => node.label),
      }
      const size = JSON.stringify(item).length + 1
      if (size <= remaining) { selected.push(item); remaining -= size }
    }
    if (!found || remaining < 100) break
  }
  const visibleModules = [] as typeof modules
  let moduleBudget = 12000
  for (const module of modules) {
    const size = JSON.stringify(module).length + 1
    if (size > moduleBudget) break
    visibleModules.push(module); moduleBudget -= size
  }
  return JSON.stringify({
    totalFiles: files.length, includedFiles: selected.length,
    totalModules: modules.length, modules: visibleModules,
    sampled: selected.length < files.length,
    files: selected,
  })
}

/** Numbered excerpts retain original locations, with explicit coverage for the model. */
export function wikiEvidence(files: IndexedFile[]) {
  let metadata = files.map(file => ({
    path: file.path,
    symbols: file.nodes.filter(node => node.kind === 'symbol').slice(0, 24).map(node => ({ name: node.label, line: node.source?.line })),
    imports: file.imports.slice(0, 12),
    totalLines: file.body.split('\n').length,
  }))
  if (JSON.stringify(metadata).length > budget / 2)
    metadata = metadata.map(item => ({ ...item, symbols: [], imports: [] }))
  const allowance = Math.max(0, Math.floor((budget - JSON.stringify(metadata).length - files.length * 100) / files.length))
  return JSON.stringify(metadata.map((item, index) => {
    const file = files[index]!, lines = file.body.split('\n')
    const candidates = new Set<number>()
    if (JSON.stringify(file.body).length <= allowance) {
      for (let i = 0; i < lines.length; i++) candidates.add(i)
    } else {
      for (let i = 0; i < Math.min(32, lines.length); i++) candidates.add(i)
      for (const node of file.nodes.filter(node => node.kind === 'symbol')) {
        const start = (node.source?.line ?? 1) - 1
        for (let i = Math.max(0, start - 2); i < Math.min(lines.length, start + 18); i++) candidates.add(i)
      }
      for (let i = Math.max(0, lines.length - 12); i < lines.length; i++) candidates.add(i)
    }
    let used = 0
    const included: number[] = []
    const excerpts = new Map<number, string>()
    let truncated = false
    for (const i of candidates) {
      let line = `${i + 1}: ${lines[i]}`
      if (JSON.stringify(line).length > allowance - used && allowance - used > 160) {
        line = `${i + 1}: ${lines[i]!.slice(0, Math.floor((allowance - used - 100) / 6))} … [此行已截断]`
        truncated = true
      }
      const cost = JSON.stringify(`${line}\n`).length
      if (used + cost > allowance) continue
      included.push(i); excerpts.set(i, line); used += cost
    }
    included.sort((a, b) => a - b)
    return { ...item, excerpted: truncated || included.length < lines.length, includedLines: included.length, text: included.map(i => excerpts.get(i)).join('\n') }
  }))
}
