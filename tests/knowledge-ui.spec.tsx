import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KnowledgeCenter } from '../src/ui/KnowledgeCenter.js'
import { WikiSetup } from '../src/ui/WikiSetup.js'
import { MemorySettings } from '../src/ui/MemorySettings.js'
import {
  ProjectKnowledgePanel,
  projectKnowledgeDocuments,
} from '../src/ui/ProjectKnowledgePanel.js'
import type {
  KnowledgeDocument,
  LingKnowledgeService,
} from '../src/runtime/knowledge.js'
const service: LingKnowledgeService = {
  request: async () => ({ ok: true, value: {} }),
}
describe('knowledge presentation boundary', () => {
  it('opens a library shelf and keeps project Wiki separate from personal memory', () => {
    const html = renderToStaticMarkup(
      <KnowledgeCenter
        service={service}
        workspaceId="project"
        workspaces={[{ workspaceId: 'project', label: '项目' }]}
        onOpenTask={() => {}}
        onSettings={() => {}}
      />,
    )
    expect(html).toContain('搜索知识库')
    expect(html).toContain('aria-label="知识中心主页面"')
    expect(html).toContain('Repo Wiki')
    expect(html).toContain('筛选生效工作区')
    expect(html).not.toContain('生成 Wiki')
    expect(html).not.toContain('建立代码索引')
    expect(html).not.toContain('会话总结</button>')
    expect(html).not.toContain('添加记忆')
  })
  it('keeps the project reader free of scope switches and management actions', () => {
    const html = renderToStaticMarkup(
      <ProjectKnowledgePanel
        service={service}
        workspaceId="project"
        workspaceLabel="atlas"
        onOpenTask={() => {}}
        onOpenCenter={() => {}}
      />,
    )
    expect(html).toContain('aria-label="当前项目知识"')
    expect(html).toContain('atlas')
    expect(html).toContain('搜索当前项目')
    expect(html).toContain('打开知识中心')
    for (const control of [
      '<select',
      '个人记忆',
      '建立代码索引',
      '生成 Wiki',
      '总结当前会话',
      '添加记忆',
      '导出',
      '记忆设置',
    ])
      expect(html).not.toContain(control)
  })
  it('does not fall back to personal or another project when no project is selected', () => {
    const html = renderToStaticMarkup(
      <ProjectKnowledgePanel
        service={service}
        workspaceLabel="不指定工作区"
        onOpenTask={() => {}}
        onOpenCenter={() => {}}
      />,
    )
    expect(html).toContain('选择项目后查看相关知识')
    expect(html).not.toContain('搜索当前项目')
    expect(html).not.toContain('个人记忆')
  })
  it('shows confirmed project knowledge, while proposals and archives remain in the center', () => {
    const base: KnowledgeDocument = {
      id: 'rule',
      scope: 'project',
      kind: 'memory',
      title: '规则',
      body: '原文',
      state: 'active',
      version: 1,
      manual: true,
      updatedAt: 1,
      sources: [],
    }
    const documents = [
      base,
      { ...base, id: 'candidate', state: 'candidate' as const },
      { ...base, id: 'archive', state: 'archived' as const },
      { ...base, id: 'stale', state: 'stale' as const, updatedAt: 2 },
    ]
    expect(projectKnowledgeDocuments(documents).map((doc) => doc.id)).toEqual([
      'stale',
      'rule',
    ])
    expect(documents.map((doc) => doc.id)).toEqual([
      'rule',
      'candidate',
      'archive',
      'stale',
    ])
  })
  it('keeps remote scope explicit and offers summaries only for the selected project', () => {
    const html = renderToStaticMarkup(
      <KnowledgeCenter
        service={service}
        initialProject
        remoteTaskId="remote"
        taskId="remote"
        workspaces={[{ workspaceId: 'local', label: '本机' }]}
        onOpenTask={() => {}}
        onSettings={() => {}}
      />,
    )
    expect(html).toContain('当前 SSH 项目')
    expect(html).toContain('Wiki 页面')
    expect(html).toContain('知识卡片')
    expect(html).not.toContain('会话总结</button>')
    expect(html).toContain('aria-label="Wiki 目录"')
  })
  it('offers a focused Wiki setup without pretending unavailable generation is enabled', () => {
    const html = renderToStaticMarkup(
      <WikiSetup
        pending={false}
        running={false}
        generated={false}
        cards={false}
        onChange={() => {}}
        onGenerate={() => {}}
        onSettings={() => {}}
      />,
    )
    for (const label of [
      '生成 Repo Wiki',
      'English',
      '简体中文',
      '自动更新 Wiki',
      'Wiki 智能体引用',
      '选择模型',
    ])
      expect(html).toContain(label)
    expect(html).toContain('disabled')
    expect(html).not.toContain('自动导出')
    expect(html).not.toContain('会话总结')
  })
  it('keeps automatic generation opt-in and settings separate from content editing', () => {
    const html = renderToStaticMarkup(
      <MemorySettings service={service} onOpenTask={() => {}} />,
    )
    expect(html).toContain('自动总结会话')
    expect(html).not.toContain('增量更新 Wiki')
    expect(html).toContain('记忆行为')
    expect(html).toContain('全局记忆')
    expect(html).toContain('项目记忆')
    expect(html).toContain('任务回顾与整理模型')
    expect(html).not.toContain('打开知识中心')
    expect(html).not.toContain('全局记忆列表尚未接入')
  })
})
