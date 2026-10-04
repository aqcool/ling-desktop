import type {
  KnowledgeDocument,
  KnowledgeSource,
} from '../runtime/knowledge.js'
export const knowledgeKinds = {
  reference: '资料',
  card: '知识卡片',
  wiki: '项目 Wiki',
  summary: '会话总结',
  memory: '记忆',
  code: '代码',
  history: '原始会话',
}
export const knowledgeStates = {
  active: '已保存',
  candidate: '待确认',
  stale: '来源已变更',
  archived: '已归档',
}
export function knowledgeOutline(documents: readonly KnowledgeDocument[]) {
  const visible = documents
    .filter((doc) => doc.state !== 'archived')
    .sort(
      (a, b) =>
        (a.position ?? 10000) - (b.position ?? 10000) ||
        a.title.localeCompare(b.title),
    )
  const result: { document: KnowledgeDocument; depth: number }[] = [],
    seen = new Set<string>()
  const visit = (doc: KnowledgeDocument, depth: number) => {
    if (seen.has(doc.id)) return
    seen.add(doc.id)
    result.push({ document: doc, depth })
    for (const child of visible.filter((item) => item.parentId === doc.id))
      visit(child, depth + 1)
  }
  for (const doc of visible.filter(
    (item) =>
      !item.parentId || !visible.some((parent) => parent.id === item.parentId),
  ))
    visit(doc, 0)
  for (const doc of visible) visit(doc, 0)
  return result
}
export function knowledgeHeadings(body: string) {
  let fence: string | undefined
  const headings: { id: string; title: string; level: number; line: number }[] =
    []
  for (const [index, line] of body.split('\n').entries()) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]![0]
      else if (marker[1]![0] === fence) fence = undefined
      continue
    }
    if (fence) continue
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (match)
      headings.push({
        id: `knowledge-heading-${headings.length}`,
        title: match[2]!.replace(/[*`_]/g, ''),
        level: match[1]!.length,
        line: index + 1,
      })
  }
  return headings
}
/** Only indexed, cited paths can turn a generated link into a source read. */
export function knowledgeCodeLink(
  href: string,
  sources: readonly KnowledgeSource[],
): KnowledgeSource | undefined {
  const match = href.match(/^code:(.+?)(?:#L(\d+))?$/)
  if (!match) return
  let path: string
  try {
    path = decodeURIComponent(match[1]!)
  } catch {
    return
  }
  const source = sources.find(
    (item) => item.kind === 'code' && item.path === path,
  )
  const line = Number(match[2] ?? source?.line ?? 1)
  return source && Number.isSafeInteger(line) && line > 0
    ? { ...source, line, endLine: undefined }
    : undefined
}
export function downloadKnowledge(text: string, name: string) {
  const url = URL.createObjectURL(
      new Blob([text], { type: 'text/markdown;charset=utf-8' }),
    ),
    anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.md`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function knowledgePreview(body: string): string {
  return body
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*`_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}
