import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fileIconType } from '../src/ui/file-icons.js'
import { FileIcon } from '../src/ui/FileIcon.js'
import { Markdown } from '../src/ui/Markdown.js'

describe('shared file icons', () => {
  it('recognizes code, office, media and archives across native paths and case', () => {
    expect(fileIconType('C:\\项目\\src\\App.TSX')).toBe('code')
    expect(fileIconType('/workspace/notes/README.md')).toBe('markdown')
    expect(fileIconType('table.xlsx')).toBe('spreadsheet')
    expect(fileIconType('deck.pptx')).toBe('presentation')
    expect(fileIconType('letter.docx')).toBe('document')
    expect(fileIconType('report.pdf')).toBe('pdf')
    expect(fileIconType('photo.avif')).toBe('image')
    expect(fileIconType('recording.m4a')).toBe('audio')
    expect(fileIconType('clip.webm')).toBe('video')
    expect(fileIconType('backup.tar.gz')).toBe('archive')
  })
  it('uses MIME for unnamed attachments and keeps unknown types neutral', () => {
    expect(fileIconType('attachment', 'image/png')).toBe('image')
    expect(fileIconType('attachment', 'audio/wav; codecs=pcm')).toBe('audio')
    expect(fileIconType('attachment', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('spreadsheet')
    expect(fileIconType('file.unknown', 'application/octet-stream')).toBe('file')
    expect(fileIconType('.gitignore')).toBe('file')
    expect(fileIconType('malformed%path')).toBe('file')
  })
  it('recognizes download URLs without confusing queries for filenames', () => {
    expect(fileIconType('https://files.example.com/%E6%8A%A5%E5%91%8A%2Epdf?token=abc#page=2')).toBe('pdf')
    expect(fileIconType('https://example.com/download?name=report.pdf')).toBe('file')
  })
  it('keeps the original monochrome glyph alongside the themed file-type alternative', () => {
    const file = renderToStaticMarkup(<FileIcon path="sheet.xlsx" size={16} />)
    expect(file).toContain('data-file-type="spreadsheet"')
    expect(file).toContain('data-icon="file"')
    expect(file).toContain('data-file-icon="grid"')
    // Color glyphs opt out of theme artwork; the original simple glyph keeps it.
    expect(file.match(/data-icon=/g)).toHaveLength(1)
    const folder = renderToStaticMarkup(<FileIcon path="src" directory expanded />)
    expect(folder).toContain('data-file-type="folder"')
    expect(folder).toContain('data-icon="folderOpen"')
    expect(folder).toContain('data-file-icon="folderOpen"')
  })
  it('adds decorative file icons only for recognized safe Markdown file links', () => {
    const markup = renderToStaticMarkup(<Markdown source={'[报告](https://example.com/report.pdf?download=1) [主页](https://example.com/) [危险](javascript:alert(1))'} />)
    expect(markup).toContain('data-file-type="pdf"')
    expect(markup.match(/file-icon--link/g)).toHaveLength(1)
    expect(markup).not.toContain('javascript:')
  })
})
