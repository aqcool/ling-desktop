import type { IDocumentData, IWorkbookData } from '@univerjs/core'
import type { ISlideData } from '@univerjs/slides'
import { openOfficeArchive } from './ooxml.js'
export type OfficePreview = ({ kind: 'sheet'; data: IWorkbookData } | { kind: 'document'; data: IDocumentData } | { kind: 'slides'; data: ISlideData }) & { warnings: string[] }

export async function readOfficePreview(path: string, bytes: Uint8Array): Promise<OfficePreview> {
  const archive = openOfficeArchive(bytes), name = path.split('/').at(-1) ?? path
  if (/\.xlsx$/i.test(path)) { const { xlsxPreview } = await import('./xlsx.js'); return { kind: 'sheet', ...await xlsxPreview(bytes, archive, name) } }
  if (/\.docx$/i.test(path)) { const { docxPreview } = await import('./docx.js'); return { kind: 'document', ...docxPreview(archive, name) } }
  if (/\.pptx$/i.test(path)) { const { pptxPreview } = await import('./pptx.js'); return { kind: 'slides', ...pptxPreview(archive, name) } }
  throw new Error('此 Office 格式暂不支持预览。')
}
