import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Composer } from '../src/ui/Composer.js'
import { Markdown } from '../src/ui/Markdown.js'
import { toComposerQuote, toComposerWorkspaceContext, workspaceContextKey, type WorkspaceContextReference } from '../src/ui/attachments.js'

const decode = (reference: WorkspaceContextReference) => {
  const value = toComposerWorkspaceContext(reference)
  return { value, text: new TextDecoder().decode(value.attachment.data as Uint8Array) }
}

describe('workspace context transport', () => {
  it('retains remote identity and never conflates an identical path on another server or the local workspace', () => {
    const reference = { kind: 'file' as const, path: '/home/tester/config.json', server: { id: 'server-a', label: '测试服务器' } }
    const { value, text } = decode(reference)
    expect(value.context).toEqual(reference)
    expect(text).toContain('serverId: server-a')
    expect(text).toContain('不是本地工作区')
    expect(text).not.toContain('请使用当前工作区的文件工具')
    expect(workspaceContextKey(reference)).not.toBe(workspaceContextKey({ ...reference, server: undefined }))
    expect(workspaceContextKey(reference)).not.toBe(workspaceContextKey({ ...reference, server: { id: 'server-b', label: '另一台' } }))
  })
  it('sends original file and directory paths without copying their contents', () => {
    const file = decode({ kind: 'file', path: '/work/灵创/src/config.ts', text: 'private file contents' })
    const directory = decode({ kind: 'directory', path: 'C:\\Projects\\LING\\src\\', text: 'nested files' })
    expect(file.value.attachment.kind).toBe('file')
    expect(file.value.attachment.name).toBe('config.ts.context.md')
    expect(file.value.context).toEqual({ kind: 'file', path: '/work/灵创/src/config.ts' })
    expect(file.text).toContain('/work/灵创/src/config.ts')
    expect(file.text).not.toContain('private file contents')
    expect(directory.value.context).toEqual({ kind: 'directory', path: 'C:\\Projects\\LING\\src\\' })
    expect(directory.text).toContain('C:\\Projects\\LING\\src\\')
    expect(directory.text).not.toContain('nested files')
    expect(file.value.size).toBe(new TextEncoder().encode(file.text).byteLength)
  })

  it('keeps selected editor text and precise inclusive line numbers, including unsaved changes', () => {
    const source = '\tconst localDraft = "尚未保存"\r\n  console.log(localDraft)\r\n'
    const reference = { kind: 'selection' as const, path: '/work/src/main.ts', startLine: 42, endLine: 44, text: source }
    const { value, text } = decode(reference)
    expect(value.context).toEqual(reference)
    expect(value.name).toBe('main.ts:42–44')
    expect(text).toContain('42–44（从 1 开始，包含起止行）')
    expect(text).toContain(source)
    expect(text).toContain('可能包含尚未保存的修改')
    expect(value.quote).toBeUndefined()
  })

  it('uses safe transport filenames for roots and Windows reserved characters without changing original paths', () => {
    const root = decode({ kind: 'directory', path: '/' })
    expect(root.value.attachment.name).toBe('workspace.context.md')
    expect(root.value.context?.path).toBe('/')
    const path = 'C:\\Project\\bad:name?*.ts'
    const file = decode({ kind: 'file', path })
    expect(file.value.attachment.name).toBe('bad_name__.ts.context.md')
    expect(file.value.context?.path).toBe(path)
    expect(file.text).toContain(path)
    expect(decode({ kind: 'file', path: 'C:\\Project\\CON.txt' }).value.attachment.name).toBe('workspace-CON.txt.context.md')
  })

  it('contains Markdown metacharacters in paths and nested code fences as literal text', () => {
    const path = '/work/[链接](https://example.com)\n# 路径中的标题\n````\n<img src="bad">.ts'
    const source = '```md\n# 代码中的标题\n```\n````\nconst html = "<script>bad</script>"'
    const { text } = decode({ kind: 'selection', path, text: source, startLine: 1, endLine: 6 })
    expect(text).toContain(`\n\`\`\`\`\`text\n${path}\n\`\`\`\`\``)
    expect(text).toContain(`\n\`\`\`\`\`text\n${source}\n\`\`\`\`\``)
    const html = renderToStaticMarkup(<Markdown source={text} />)
    expect(html.match(/<h1\b/gu)).toHaveLength(1)
    expect(html.match(/<pre\b/gu)).toHaveLength(2)
    expect(html).not.toContain('<img src="bad">')
    expect(html).not.toContain('<script>bad</script>')
    expect(html).not.toContain('<a href="https://example.com"')
  })

  it('deduplicates pointers and identical selections without dropping a changed selection', () => {
    expect(workspaceContextKey({ kind: 'file', path: '/work/a.ts' })).toBe(workspaceContextKey({ kind: 'file', path: '/work/a.ts', text: 'ignored' }))
    expect(workspaceContextKey({ kind: 'directory', path: '/work/src/' })).toBe(workspaceContextKey({ kind: 'directory', path: '/work/src' }))
    expect(workspaceContextKey({ kind: 'directory', path: '/' })).not.toBe(workspaceContextKey({ kind: 'directory', path: '/work' }))
    const selection = { kind: 'selection' as const, path: '/work/a.ts', text: 'const a = 1', startLine: 3 }
    expect(workspaceContextKey(selection)).toBe(workspaceContextKey({ ...selection, endLine: 3 }))
    expect(workspaceContextKey(selection)).not.toBe(workspaceContextKey({ ...selection, text: 'const a = 2' }))
    expect(workspaceContextKey(selection)).not.toBe(workspaceContextKey({ ...selection, startLine: 4 }))
    expect(workspaceContextKey(selection)).not.toBe(workspaceContextKey({ kind: 'file', path: selection.path }))
  })

  it('rejects empty paths, missing selection text and invalid original line ranges', () => {
    for (const reference of [
      { kind: 'file', path: '' }, { kind: 'directory', path: '/work\0bad' },
      { kind: 'selection', path: '/work/a.ts' }, { kind: 'selection', path: '/work/a.ts', text: '' },
      { kind: 'selection', path: '/work/a.ts', text: 'a', startLine: 0 },
      { kind: 'selection', path: '/work/a.ts', text: 'a', startLine: 3, endLine: 2 },
      { kind: 'selection', path: '/work/a.ts', text: 'a', endLine: 2 },
    ] as const) expect(() => toComposerWorkspaceContext(reference)).toThrow()
  })
})

describe('workspace context composer chips', () => {
  it('distinguishes file, directory and range selection while retaining reply quotes and uploads', () => {
    const contexts = [
      toComposerWorkspaceContext({ kind: 'file', path: '/work/src/config.ts' }),
      toComposerWorkspaceContext({ kind: 'directory', path: '/work/src/components/' }),
      toComposerWorkspaceContext({ kind: 'selection', path: '/work/src/view.tsx', text: 'return <View />', startLine: 12, endLine: 15 }),
    ]
    const upload = { id: 'upload', name: 'notes.txt', size: 1024, isImage: false,
      attachment: { kind: 'file' as const, name: 'notes.txt', data: new TextEncoder().encode('uploaded text') } }
    const html = renderToStaticMarkup(<Composer
      value="" attachments={[...contexts, upload, toComposerQuote('原始回复')]} recordedAttachments={[{ attachmentId: 'recorded', kind: 'file', name: 'report.txt', bytes: 2048 }]}
      running={false} hasTask disabled={false} modelLabel="DeepSeek" taskScoped={false}
      onChange={() => {}} onAddFiles={() => {}} onRemoveAttachment={() => {}} onRemoveRecordedAttachment={() => {}}
      onSubmit={() => {}} onStop={() => {}} onSelectModel={() => {}} onOpenModelSettings={() => {}}
      onSelectPermission={() => {}} onPlanModeToggle={() => {}} onGoalAction={() => {}}
    />)
    expect(html).toContain('data-context-kind="file"')
    expect(html).toContain('data-context-kind="directory"')
    expect(html).toContain('data-context-kind="selection"')
    expect(html).toContain('data-file-type="folder"')
    expect(html).toContain('title="/work/src/config.ts"')
    expect(html).toContain('title="/work/src/view.tsx:12–15"')
    expect(html).toContain('view.tsx:12–15')
    expect(html).toContain('aria-label="移除目录引用：components"')
    expect(html).toContain('aria-label="移除选区引用：view.tsx:12–15"')
    expect(html).toContain('aria-label="移除引用对话"')
    expect(html).toContain('notes.txt')
    expect(html).toContain('1.0 KB')
    expect(html).toContain('report.txt')
    expect(html).toContain('2.0 KB')
    const send = html.match(/<button[^>]*aria-label="发送"[^>]*>/u)?.[0]
    expect(send).toBeDefined()
    expect(send).not.toMatch(/\sdisabled(?:=|\s|>)/u)
  })
})
