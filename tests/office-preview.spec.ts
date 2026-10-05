// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DateSystem } from '@univerjs/core'
import ExcelJS from 'exceljs'
import { readOfficePreview } from '../src/office/preview.js'
import { officeXml, openOfficeArchive, relations } from '../src/office/ooxml.js'
import { officeZip, sampleDocx, samplePptx, samplePptxWithLayout, sampleXlsx } from './fixtures/office.js'

describe('open-source Office preview adapters', () => {
  it.each([false, true])('previews empty worksheets alongside populated sheets: %s', async populated => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('空白工作表')
    if (populated) workbook.addWorksheet('内容').getCell('A1').value = '正常内容'
    const result = await readOfficePreview('empty-sheet.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()))
    if (result.kind !== 'sheet') throw new Error('sheet expected')
    expect(result.data.sheetOrder).toHaveLength(populated ? 2 : 1)
    expect(result.data.sheets[result.data.sheetOrder[0]!]!).toMatchObject({
      name: '空白工作表', cellData: {}, columnData: {}, rowCount: 100, columnCount: 20,
    })
    if (populated) expect(result.data.sheets[result.data.sheetOrder[1]!]!.cellData![0]![0]?.v).toBe('正常内容')
  })
  it('reads sheets, cached formulas, dates, styles, merges and freezes without formula execution', async () => {
    const result = await readOfficePreview('计划.xlsx', await sampleXlsx())
    expect(result.kind).toBe('sheet')
    if (result.kind !== 'sheet') throw new Error('sheet expected')
    expect(result.data.dateSystem).toBe(DateSystem.Date1900)
    expect(result.data.sheetOrder).toHaveLength(2)
    const sheet = result.data.sheets[result.data.sheetOrder[0]!]!
    expect(sheet.cellData![3]![1]).toMatchObject({ v: 11, t: 2 })
    expect(sheet.cellData![3]![1]?.f).toBeUndefined()
    expect(sheet.cellData![4]![0]).toMatchObject({ v: 46300, s: { n: { pattern: 'yyyy-mm-dd' } } })
    expect(sheet.cellData![0]![0]?.s).toMatchObject({ bl: 1, bg: { rgb: '#47745D' } })
    expect(sheet.mergeData).toEqual([{ startRow: 5, endRow: 5, startColumn: 0, endColumn: 2 }])
    expect(sheet.freeze?.ySplit).toBe(1)
    expect(result.warnings).toEqual([])
  })
  it('preserves document styles and excludes deleted revisions', async () => {
    const result = await readOfficePreview('readme.docx', sampleDocx())
    if (result.kind !== 'document') throw new Error('document expected')
    expect(result.data.body?.dataStream).toContain('项目预览 · LING\rOffice 文档')
    expect(result.data.body?.dataStream).not.toContain('已删除')
    expect(result.data.body?.textRuns?.[0]?.ts).toMatchObject({ bl: 1, fs: 20 })
    expect(result.data.body?.paragraphs?.every(item => !!item.paragraphId)).toBe(true)
  })
  it('maps ordinary Word tables and embedded images without external requests', async () => {
    const result = await readOfficePreview('report.docx', sampleDocx())
    if (result.kind !== 'document') throw new Error('document expected')
    const table = result.data.tableSource?.['table-0']
    expect(table?.tableRows).toHaveLength(2)
    expect(table?.tableColumns).toHaveLength(2)
    expect(table?.tableRows[0]?.tableCells[0]?.backgroundColor).toEqual({ rgb: '#E4EEE8' })
    const image = result.data.drawings?.['image-0']
    expect(image).toMatchObject({ docTransform: { size: { width: 200, height: 100 } }, selectable: false, allowTransform: false, source: expect.stringMatching(/^data:image\/png;base64,/) })
    const block = result.data.body?.customBlocks?.[0]
    expect(block?.blockId).toBe('image-0')
    expect(result.data.body?.dataStream[block!.startIndex]).toBe('\b')
    expect(result.warnings).toEqual([])
  })
  it('keeps slide order, dimensions and formatted authored text', async () => {
    const result = await readOfficePreview('slides.pptx', samplePptx())
    if (result.kind !== 'slides') throw new Error('slides expected')
    expect(result.data.pageSize).toEqual({ width: 960, height: 540 })
    expect(result.data.body?.pageOrder).toEqual(['slide-0', 'slide-1'])
    const element = Object.values(result.data.body!.pages['slide-0']!.pageElements)[0]!
    expect(element.richText?.rich?.body?.dataStream).toContain('LING · 幻灯片 1')
    expect(element.richText?.rich?.body?.textRuns?.[0]?.ts).toMatchObject({ fs: 32, bl: 1 })
    expect(result.warnings).toEqual([])
  })
  it('inherits placeholder positions and text styles from the layout/master', async () => {
    const result = await readOfficePreview('template.pptx', samplePptxWithLayout())
    if (result.kind !== 'slides') throw new Error('slides expected')
    const element = Object.values(result.data.body!.pages['slide-0']!.pageElements)[0]!
    expect(element).toMatchObject({ left: 60, top: 60, width: 840, height: 200 })
    expect(element.richText?.rich?.body?.textRuns?.[0]?.ts).toMatchObject({ fs: 40, bl: 1 })
    expect(result.warnings).toHaveLength(1)
  })
  it('rejects damaged, oversized or entity-bearing documents and ignores external relationships', async () => {
    await expect(readOfficePreview('bad.xlsx', new Uint8Array([1, 2, 3]))).rejects.toThrow('损坏或已加密')
    await expect(readOfficePreview('big.docx', new Uint8Array(16 * 1024 * 1024 + 1))).rejects.toThrow('16 MB')
    expect(() => openOfficeArchive(officeZip({ huge: new Uint8Array(16 * 1024 * 1024 + 1) }))).toThrow('解压后的内容过大')
    const archive = openOfficeArchive(officeZip({
      'word/document.xml': '<!DOCTYPE doc [<!ENTITY secret SYSTEM "file:///etc/passwd">]><doc>&secret;</doc>',
      'word/_rels/document.xml.rels': '<Relationships><Relationship Id="external" Target="https://example.com/a.png" TargetMode="External"/><Relationship Id="local" Target="media/a.png"/></Relationships>',
    }))
    expect(() => officeXml(archive, 'word/document.xml')).toThrow('XML 声明')
    expect(relations(archive, 'word/document.xml')).toEqual(new Map([['local', 'word/media/a.png']]))
  })
})
