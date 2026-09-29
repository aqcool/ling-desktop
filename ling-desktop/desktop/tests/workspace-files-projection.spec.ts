import { describe, expect, it, vi } from 'vitest'
import { createDshWorkspaceFilesProjection } from '../src/client/workspace-files-projection.js'

const answer = <Value>(value: Value) => ({ ok: true as const, value })

function projection(list: unknown, read: unknown, readAll: unknown = vi.fn(), render: unknown = vi.fn()) {
  return createDshWorkspaceFilesProjection({
    workspaceFiles: { list, read, readAll },
    officeToPdf: { render },
  } as never)
}

describe('DSH workspace files projection', () => {
  it('asks the host for the root as "." and reports workspace-relative entry paths', async () => {
    const list = vi.fn(async () => answer({
      path: '',
      entries: [
        { name: 'notes', type: 'directory' },
        { name: 'plan.md', type: 'file', size: 2048 },
      ],
      truncated: false,
    }))
    const result = await projection(list, vi.fn()).list('session-1', '')

    expect(list).toHaveBeenCalledWith('session-1', '.', undefined)
    expect(result).toEqual({
      ok: true,
      value: {
        path: '',
        truncated: false,
        entries: [
          { name: 'notes', path: 'notes', kind: 'directory' },
          { name: 'plan.md', path: 'plan.md', kind: 'file', bytes: 2048 },
        ],
      },
    })
  })

  it('joins nested listing paths under the directory the host reported', async () => {
    const list = vi.fn(async () => answer({
      path: 'src/client',
      entries: [{ name: 'index.ts', type: 'file', size: 12 }],
      truncated: true,
    }))

    await expect(projection(list, vi.fn()).list('session-1', 'src/client')).resolves.toEqual({
      ok: true,
      value: {
        path: 'src/client',
        truncated: true,
        entries: [{ name: 'index.ts', path: 'src/client/index.ts', kind: 'file', bytes: 12 }],
      },
    })
  })

  it('keeps host path failures as read rejections instead of empty directories', async () => {
    const list = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'workspace-file/not-found', message: 'no entry at "gone"' },
    }))

    await expect(projection(list, vi.fn()).list('session-1', 'gone')).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      message: 'no entry at "gone"',
      retryable: false,
    })
  })

  it('reads a bounded text preview and marks a page that stops before the last line', async () => {
    const read = vi.fn(async () => answer({
      absolutePath: '/tmp/demo/plan.md',
      version: 'v1',
      bytes: 90_000,
      offset: 1,
      text: 'line one\nline two',
      lines: 600,
      eof: false,
    }))
    const result = await projection(vi.fn(), read).readDocument('session-1', 'plan.md')

    expect(read).toHaveBeenCalledWith('session-1', 'plan.md', { limit: 600 }, undefined)
    expect(result).toEqual({
      ok: true,
      value: {
        path: 'plan.md',
        kind: 'markdown',
        mediaType: 'text/markdown',
        text: 'line one\nline two',
        lines: 600,
        truncated: true,
        bytes: 90_000,
      },
    })
  })

  it('classifies code and unknown suffixes on the text preview path', async () => {
    const read = vi.fn(async () => answer({
      absolutePath: '/tmp/demo/x',
      version: 'v1',
      offset: 1,
      text: 'body',
      lines: 1,
      eof: true,
    }))
    const files = projection(vi.fn(), read)

    await expect(files.readDocument('session-1', 'src/app.ts')).resolves.toEqual({
      ok: true,
      value: { path: 'src/app.ts', kind: 'code', mediaType: 'text/plain', text: 'body', lines: 1, truncated: false },
    })
    await expect(files.readDocument('session-1', 'notes.unknown-suffix')).resolves.toEqual({
      ok: true,
      value: { path: 'notes.unknown-suffix', kind: 'text', mediaType: 'text/plain', text: 'body', lines: 1, truncated: false },
    })
  })

  it('reads complete bytes for image and PDF previews', async () => {
    const readAll = vi.fn(async () => answer({
      absolutePath: '/tmp/demo/shot.png',
      version: 'v1',
      bytes: 4,
      offset: 0,
      data: 'QUFBQQ==',
      eof: true,
    }))
    const files = projection(vi.fn(), vi.fn(), readAll)

    await expect(files.readDocument('session-1', 'assets/shot.png')).resolves.toEqual({
      ok: true,
      value: {
        path: 'assets/shot.png',
        kind: 'image',
        mediaType: 'image/png',
        data: 'QUFBQQ==',
        bytes: 4,
      },
    })
    await expect(files.readDocument('session-1', 'report.pdf')).resolves.toEqual({
      ok: true,
      value: {
        path: 'report.pdf',
        kind: 'pdf',
        mediaType: 'application/pdf',
        data: 'QUFBQQ==',
        bytes: 4,
      },
    })
    expect(readAll).toHaveBeenCalledWith('session-1', 'assets/shot.png', undefined)
    expect(readAll).toHaveBeenCalledWith('session-1', 'report.pdf', undefined)
  })

  it('converts Office documents to a PDF preview and keeps the missing-font notice', async () => {
    const render = vi.fn(async () => answer({
      absolutePath: '/tmp/demo/report.docx',
      version: 'v1',
      offset: 0,
      data: 'UERG',
      eof: true,
      bytes: 12_345,
      missingFonts: ['Fancy Sans'],
    }))
    const files = projection(vi.fn(), vi.fn(), vi.fn(), render)

    await expect(files.readDocument('session-1', 'report.docx')).resolves.toEqual({
      ok: true,
      value: {
        path: 'report.docx',
        kind: 'pdf',
        mediaType: 'application/pdf',
        data: 'UERG',
        converted: true,
        missingFonts: ['Fancy Sans'],
        bytes: 12_345,
      },
    })
    expect(render).toHaveBeenCalledWith('session-1', 'report.docx', 'foreground', undefined)
  })

  it('maps Office conversion failures to product copy', async () => {
    const render = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'document-render/failed',
        message: 'conversion exploded',
        details: { reason: 'unsupported-format' },
      },
    }))
    const files = projection(vi.fn(), vi.fn(), vi.fn(), render)

    await expect(files.readDocument('session-1', 'broken.docx')).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      message: '暂不支持这种文档格式的预览。',
      retryable: false,
    })
  })

  it('states an oversized binary preview instead of streaming it', async () => {
    const readAll = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'workspace-file/too-large', message: '"big.png" exceeds the read cap' },
    }))
    const files = projection(vi.fn(), vi.fn(), readAll)

    await expect(files.readDocument('session-1', 'big.png')).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      message: '文件过大，无法预览。',
      retryable: false,
    })
  })

  it('names known binary containers as unviewable without asking the host', async () => {
    const read = vi.fn()
    const readAll = vi.fn()
    const render = vi.fn()
    const files = projection(vi.fn(), read, readAll, render)

    await expect(files.readDocument('session-1', 'tool.zip')).resolves.toEqual({
      ok: true,
      value: { path: 'tool.zip', kind: 'unsupported', mediaType: 'application/octet-stream' },
    })
    expect(read).not.toHaveBeenCalled()
    expect(readAll).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('maps a binary file rejection without losing the host message', async () => {
    const read = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'workspace-file/not-text', message: '"notes.data" contains NUL bytes' },
    }))

    await expect(projection(vi.fn(), read).readDocument('session-1', 'notes.data')).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      message: '"notes.data" contains NUL bytes',
      retryable: false,
    })
  })

  it('reports unavailable when the workspace file remote is missing', async () => {
    const remote = { get workspaceFiles(): never { throw new TypeError('missing namespace') } }
    const files = createDshWorkspaceFilesProjection(remote as never)

    const directory = await files.list('session-1', '')
    const document = await files.readDocument('session-1', 'plan.md')
    expect(directory).toEqual({ ok: false, reason: 'runtime-unavailable', message: '目录内容暂时不可用。', retryable: true })
    expect(document).toEqual({ ok: false, reason: 'runtime-unavailable', message: '文档预览暂时不可用。', retryable: true })
  })
})
