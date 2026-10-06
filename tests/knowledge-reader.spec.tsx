import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KnowledgeReader } from '../src/ui/KnowledgeReader.js'
import {
  knowledgeCodeLink,
  knowledgeHeadings,
  knowledgeOutline,
} from '../src/ui/knowledge-view.js'
import type { KnowledgeDocument } from '../src/runtime/knowledge.js'
const doc: KnowledgeDocument = {
  id: 'overview',
  scope: 'project',
  kind: 'wiki',
  title: '项目概览',
  body: '## 入口\n[start](code:main.ts#L1)\n\n## 运行方式\n参考入口。',
  sources: [
    { kind: 'code', label: 'main.ts', path: 'main.ts', hash: 'abc', line: 1 },
  ],
  state: 'active',
  version: 1,
  manual: false,
  updatedAt: 1,
}
describe('knowledge reading navigation', () => {
  it('has clickable code references and matching article anchors without changing ordinary chat Markdown', () => {
    const html = renderToStaticMarkup(
      <KnowledgeReader
        document={doc}
        pending={false}
        onSave={async () => undefined}
        onArchive={() => {}}
        onSource={() => {}}
        onWiki={() => {}}
        onOpenTask={() => {}}
        onExport={async () => undefined}
      />,
    )
    expect(html).toContain('aria-label="页内目录"')
    expect(html).toContain('id="knowledge-heading-0"')
    expect(html).toContain('id="knowledge-heading-1"')
    expect(html).toContain('>start</button>')
    expect(html).not.toContain('href="code:')
  })
  it('does not treat fenced code as document headings and binds generated links to cited paths', () => {
    expect(
      knowledgeHeadings('## 页面\n```md\n## 不是真实目录\n```\n### 内容').map(
        (item) => item.title,
      ),
    ).toEqual(['页面', '内容'])
    expect(knowledgeCodeLink('code:main.ts#L10', doc.sources)).toMatchObject({
      path: 'main.ts',
      line: 10,
      hash: 'abc',
    })
    expect(
      knowledgeCodeLink('code:../../secret#L1', doc.sources),
    ).toBeUndefined()
    expect(knowledgeCodeLink('code:main.ts#L0', doc.sources)).toBeUndefined()
  })
  it('orders chapters by parent and position and tolerates missing archived parents', () => {
    const docs = [
      { ...doc, id: 'child', title: '子页面', parentId: 'parent', position: 1 },
      { ...doc, id: 'parent', title: '主页面', position: 0 },
      { ...doc, id: 'archived', state: 'archived' as const },
    ]
    expect(
      knowledgeOutline(docs).map((item) => [item.document.id, item.depth]),
    ).toEqual([
      ['parent', 0],
      ['child', 1],
    ])
    expect(knowledgeOutline([{ ...doc, parentId: 'missing' }])).toHaveLength(1)
  })
})
