import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KnowledgeCenter } from '../src/ui/KnowledgeCenter.js'
import { WikiSetup } from '../src/ui/WikiSetup.js'
import { MemorySettings } from '../src/ui/MemorySettings.js'
import { KnowledgeSpace } from '../src/ui/KnowledgeSpace.js'
import type { LingKnowledgeService } from '../src/runtime/knowledge.js'
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
    expect(html).not.toContain('知识中心更多操作')
    expect(html).not.toContain('记忆与模型设置')
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
    expect(html).toContain('概览')
    expect(html).toContain('生成 Repo Wiki')
    expect(html).not.toContain('aria-label="项目知识视图"')
    expect(html).not.toContain('项目工具')
    expect(html).not.toContain('记忆与模型设置')
    expect(html).not.toContain('aria-label="Wiki 目录"')
    expect(html).not.toContain('隐藏目录')
  })
  it('keeps a library focused on its own documents and management', () => {
    const html = renderToStaticMarkup(
      <KnowledgeSpace
        service={service}
        scope={{ workspaceId: null, libraryId: 'library' }}
        label="团队资料"
        library={{ id: 'library', name: '团队资料', description: '', workspaceId: null, scope: 'global', scopeLabel: '全部工作区', version: 1, updatedAt: 1, documents: 0 }}
        onBack={() => {}}
        onSettings={() => {}}
        onOpenTask={() => {}}
      />,
    )
    expect(html).toContain('aria-label="知识库资料"')
    expect(html).not.toContain('项目知识视图')
    expect(html).not.toContain('项目工具')
    expect(html).not.toContain('记忆与模型设置')
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
      '配置模型',
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
