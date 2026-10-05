import type { KnowledgeDocument, KnowledgeMap, KnowledgeMapEdge, KnowledgeMapNode } from 'ling-desktop/runtime'

const nodeLimit = 200
const edgeLimit = 500

/** A read-only projection of recorded provenance; never infers a semantic relation. */
export function knowledgeMap(documents: KnowledgeDocument[], options: { query?: string; focusId?: string; paths?: ReadonlySet<string>; kinds?: KnowledgeMapNode['kind'][]; depth?: 1 | 2 } = {}): KnowledgeMap {
  const visible = documents.filter(doc => doc.kind !== 'memory' && doc.state !== 'archived')
  const nodes = new Map<string, KnowledgeMapNode>(), edges = new Map<string, KnowledgeMapEdge>()
  const documentNode = (id: string) => `document:${id}`
  const connect = (source: string, target: string, kind: KnowledgeMapEdge['kind'], citation?: KnowledgeMapEdge['citation']) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return
    const id = JSON.stringify([source, target, kind])
    edges.set(id, { id, source, target, kind, ...(citation ? { citation } : {}) })
  }
  for (const doc of visible) nodes.set(documentNode(doc.id), { id: documentNode(doc.id), label: doc.title, kind: doc.kind as KnowledgeMapNode['kind'], documentId: doc.id, state: doc.state })
  const wikis = visible.filter(doc => doc.kind === 'wiki').sort((a, b) => b.id.length - a.id.length)
  for (const doc of visible) {
    const id = documentNode(doc.id)
    if (doc.parentId) connect(documentNode(doc.parentId), id, 'contains')
    if (doc.kind === 'card') {
      const wiki = wikis.find(page => doc.id.startsWith(`${page.id.replace(/^wiki:/, 'card:')}:`))
      if (wiki) connect(documentNode(wiki.id), id, 'derived')
    }
    for (const match of doc.body.matchAll(/\]\(wiki:([^\s)]+)\)/g)) {
      const page = wikis.find(page => page.id.endsWith(`:${match[1]}`))
      if (page) connect(id, documentNode(page.id), 'links')
    }
    for (const source of doc.sources) {
      const pointer = source.kind === 'code' ? source.path?.replaceAll('\\', '/') : source.kind === 'session' ? source.sessionId : undefined
      if (!pointer) continue
      if (source.kind === 'code' && pointer.replaceAll('\\', '/').split('/').some(part => part.toLowerCase() === '.git')) continue
      if (source.kind === 'code' && options.paths && !options.paths.has(pointer)) continue
      // Scope is part of source identity; equal display paths in different projects never merge.
      const target = JSON.stringify([source.kind, doc.scope, pointer])
      if (!nodes.has(target)) nodes.set(target, {
        id: target, label: source.kind === 'code' ? pointer : source.label,
        kind: source.kind === 'code' ? 'file' : 'session',
        source: source.kind === 'code' ? { ...source, path: pointer, label: pointer, line: 1, endLine: undefined } : source,
      })
      connect(id, target, 'cites', source)
    }
  }
  if (options.kinds) for (const [id, node] of nodes) if (!options.kinds.includes(node.kind)) nodes.delete(id)
  const allEdges = [...edges.values()].filter(edge => nodes.has(edge.source) && nodes.has(edge.target))
  const neighbors = new Map<string, Set<string>>()
  for (const edge of allEdges) {
    for (const [from, to] of [[edge.source, edge.target], [edge.target, edge.source]] as const) {
      if (!neighbors.has(from)) neighbors.set(from, new Set())
      neighbors.get(from)!.add(to)
    }
  }
  const query = options.query?.trim().toLocaleLowerCase()
  if (options.focusId && !nodes.has(options.focusId)) throw Error('此知识节点已不存在，请返回全部关系。')
  const seeds = options.focusId ? [options.focusId] : query ? [...nodes.values()].filter(node => node.label.toLocaleLowerCase().includes(query)).map(node => node.id) : [...nodes.keys()]
  const wanted = new Set(seeds)
  if (query || options.focusId) {
    let frontier = seeds
    for (let depth = 0; depth < (options.depth ?? 1); depth++) {
      const next: string[] = []
      for (const id of frontier) for (const neighbor of neighbors.get(id) ?? []) if (!wanted.has(neighbor)) { wanted.add(neighbor); next.push(neighbor) }
      frontier = next
    }
  }
  const included = new Set(seeds.slice(0, query || options.focusId ? nodeLimit : 80))
  // Place neighbors of each seed before unrelated nodes when bounding the overview.
  for (const id of [...included]) {
    if (included.size >= nodeLimit) break
    for (const neighbor of neighbors.get(id) ?? []) {
      if (included.size >= nodeLimit) break
      included.add(neighbor)
    }
  }
  for (const id of query || options.focusId ? wanted : seeds) {
    if (included.size >= nodeLimit) break
    included.add(id)
  }
  const selectedEdges = allEdges.filter(edge => included.has(edge.source) && included.has(edge.target))
  return {
    nodes: [...included].map(id => nodes.get(id)!), edges: selectedEdges.slice(0, edgeLimit),
    totalNodes: nodes.size, totalEdges: allEdges.length,
    truncated: wanted.size > included.size || selectedEdges.length > edgeLimit,
  }
}
