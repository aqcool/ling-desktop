import { DataStreamTreeTokenType as Token, DocumentFlavor, DrawingTypeEnum, HorizontalAlign, ImageSourceType, LocaleType, ObjectRelativeFromH, ObjectRelativeFromV, PositionedObjectLayoutType, TableAlignmentType, TableRowHeightRule, TableSizeType, TableTextWrapType, type IDocumentData, type IParagraphStyle, type ITextStyle, type ITable, type ITableCell } from '@univerjs/core'
import type { IDocImage } from '@univerjs/preset-docs-drawing'
import { attr, child, children, descendants, enabled, imageSource, numeric, officeXml, relations, rgb, type OfficeArchive } from './ooxml.js'

const align = (value: string | undefined) => value === 'center' ? HorizontalAlign.CENTER : value === 'right' || value === 'end' ? HorizontalAlign.RIGHT : value === 'both' ? HorizontalAlign.JUSTIFIED : HorizontalAlign.LEFT
function runStyle(properties: Element | undefined): ITextStyle {
  const font = child(properties, 'rFonts')
  return {
    ...(font ? { ff: attr(font, 'ascii') ?? attr(font, 'eastAsia'), eastAsiaFontFamily: attr(font, 'eastAsia') } : {}),
    ...(child(properties, 'sz') ? { fs: numeric(attr(child(properties, 'sz'), 'val'), 22) / 2 } : {}),
    ...(child(properties, 'b') ? { bl: enabled(child(properties, 'b')) ? 1 : 0 } : {}),
    ...(child(properties, 'i') ? { it: enabled(child(properties, 'i')) ? 1 : 0 } : {}),
    ...(child(properties, 'u') ? { ul: { s: attr(child(properties, 'u'), 'val') === 'none' ? 0 : 1 } } : {}),
    ...(child(properties, 'strike') ? { st: { s: enabled(child(properties, 'strike')) ? 1 : 0 } } : {}),
    ...(rgb(attr(child(properties, 'color'), 'val')) ? { cl: { rgb: rgb(attr(child(properties, 'color'), 'val')) } } : {}),
    ...(child(properties, 'vanish') ? { hidden: enabled(child(properties, 'vanish')) } : {}),
  }
}
function paragraphStyle(properties: Element | undefined): IParagraphStyle {
  const spacing = child(properties, 'spacing'), indent = child(properties, 'ind')
  return {
    ...(child(properties, 'jc') ? { horizontalAlign: align(attr(child(properties, 'jc'), 'val')) } : {}),
    ...(attr(spacing, 'before') ? { spaceAbove: { v: numeric(attr(spacing, 'before')) / 15 } } : {}),
    ...(attr(spacing, 'after') ? { spaceBelow: { v: numeric(attr(spacing, 'after')) / 15 } } : {}),
    ...(attr(indent, 'left') ? { indentStart: { v: numeric(attr(indent, 'left')) / 15 } } : {}),
    ...(attr(indent, 'firstLine') ? { indentFirstLine: { v: numeric(attr(indent, 'firstLine')) / 15 } } : {}),
    ...(enabled(child(properties, 'pageBreakBefore')) ? { pageBreakBefore: 1 } : {}),
  }
}

/** LING-owned OOXML adapter. It does not use Univer Exchange or proprietary code. */
export function docxPreview(archive: OfficeArchive, title: string): { data: IDocumentData; warnings: string[] } {
  const doc = officeXml(archive, 'word/document.xml')!
  const stylesXml = officeXml(archive, 'word/styles.xml', true)
  const defaults = stylesXml ? descendants(stylesXml, 'docDefaults')[0] : undefined
  const styles = new Map<string, Element>()
  for (const style of stylesXml ? descendants(stylesXml, 'style') : []) {
    const id = attr(style, 'styleId'); if (id) styles.set(id, style)
  }
  const inherited = (id: string | undefined, seen = new Set<string>()): { run: ITextStyle; paragraph: IParagraphStyle } => {
    const node = id ? styles.get(id) : undefined
    if (!node || !id || seen.has(id)) return { run: {}, paragraph: {} }
    seen.add(id)
    const parent = inherited(attr(child(node, 'basedOn'), 'val'), seen)
    return { run: { ...parent.run, ...runStyle(child(node, 'rPr')) }, paragraph: { ...parent.paragraph, ...paragraphStyle(child(node, 'pPr')) } }
  }
  const defaultStyleId = [...styles].find(([, style]) => attr(style, 'type') === 'paragraph' && enabled(style) && attr(style, 'default') === '1')?.[0]
  const base = inherited(defaultStyleId)
  const warnings: string[] = []
  const omitted = ['pict', 'anchor', 'vMerge', 'headerReference', 'footerReference', 'footnoteReference', 'endnoteReference', 'numPr', 'altChunk'].some(name => descendants(doc, name).length > 0)
  if (omitted) warnings.push('此文档的图片、纵向合并表格、编号、页眉页脚或其他复杂排版未完整还原。')
  const id = crypto.randomUUID(), imageRelations = relations(archive, 'word/document.xml')
  const drawings: Record<string, IDocImage> = {}
  const body: NonNullable<IDocumentData['body']> = { dataStream: '', textRuns: [], paragraphs: [], sectionBreaks: [], tables: [], customBlocks: [] }
  const appendImage = (node: Element) => {
    const inline = descendants(node, 'inline')[0], blip = inline ? descendants(inline, 'blip')[0] : undefined
    if (!inline) return
    const source = imageSource(archive, imageRelations.get(attr(blip, 'embed') ?? ''))
    if (!source) { if (!warnings.includes('部分图片格式或外部图片不受支持。')) warnings.push('部分图片格式或外部图片不受支持。'); return }
    const extent = child(inline, 'extent'), properties = child(inline, 'docPr'), drawingId = `image-${Object.keys(drawings).length}`
    const width = Math.max(1, Math.min(4096, numeric(attr(extent, 'cx'), 914400) / 9525)), height = Math.max(1, Math.min(4096, numeric(attr(extent, 'cy'), 914400) / 9525))
    drawings[drawingId] = { unitId: id, subUnitId: id, drawingId, drawingType: DrawingTypeEnum.DRAWING_IMAGE, imageSourceType: ImageSourceType.BASE64, source,
      layoutType: PositionedObjectLayoutType.INLINE, title: attr(properties, 'name'), description: attr(properties, 'descr'), selectable: false, allowTransform: false,
      locks: { noSelect: true, noMove: true, noResize: true, noRotate: true },
      docTransform: { size: { width, height }, positionH: { relativeFrom: ObjectRelativeFromH.COLUMN, posOffset: 0 }, positionV: { relativeFrom: ObjectRelativeFromV.PARAGRAPH, posOffset: 0 }, angle: 0 },
    }
    body.customBlocks!.push({ startIndex: body.dataStream.length, blockId: drawingId }); body.dataStream += '\b'
  }
  const tableSource: NonNullable<IDocumentData['tableSource']> = {}
  const paragraphs = descendants(doc, 'p')
  if (paragraphs.length > 10_000) throw new Error('文档段落过多，无法预览。')
  const appendParagraph = (paragraph: Element) => {
    const properties = child(paragraph, 'pPr')
    const named = inherited(attr(child(properties, 'pStyle'), 'val'))
    for (const run of descendants(paragraph, 'r')) {
      // Deleted revisions are not part of the visible document.
      let deleted = false
      for (let ancestor = run.parentElement; ancestor && ancestor !== paragraph; ancestor = ancestor.parentElement) if (ancestor.localName === 'del' || ancestor.localName === 'p') deleted = true
      if (deleted) continue
      const runProperties = child(run, 'rPr')
      const start = body.dataStream.length
      for (const item of Array.from(run.children)) {
        if (item.localName === 't') body.dataStream += item.textContent ?? ''
        else if (item.localName === 'tab') body.dataStream += '\t'
        else if (item.localName === 'br') body.dataStream += attr(item, 'type') === 'page' ? '\f' : '\n'
        else if (item.localName === 'cr') body.dataStream += '\n'
        else if (item.localName === 'drawing') appendImage(item)
      }
      if (body.dataStream.length === start) continue
      body.textRuns!.push({ st: start, ed: body.dataStream.length, ts: { ...base.run, ...named.run, ...inherited(attr(child(runProperties, 'rStyle'), 'val')).run, ...runStyle(runProperties) } })
    }
    body.paragraphs!.push({ paragraphId: `p-${body.paragraphs!.length}`, startIndex: body.dataStream.length, paragraphStyle: { ...base.paragraph, ...named.paragraph, ...paragraphStyle(properties) } })
    body.dataStream += '\r'
  }
  const section = descendants(doc, 'sectPr').at(-1), size = child(section, 'pgSz'), margins = child(section, 'pgMar')
  const pageWidth = numeric(attr(size, 'w'), 11906) / 15
  const contentWidth = Math.max(100, pageWidth - numeric(attr(margins, 'left'), 1440) / 15 - numeric(attr(margins, 'right'), 1440) / 15)
  const sectionBreak = () => { body.sectionBreaks!.push({ sectionId: `section-${body.sectionBreaks!.length}`, startIndex: body.dataStream.length }); body.dataStream += '\n' }
  const appendContent = (node: Element, depth = 0) => {
    if (depth > 12) throw new Error('文档嵌套过深，无法预览。')
    for (const item of Array.from(node.children)) {
      if (item.localName === 'p') appendParagraph(item)
      else if (item.localName === 'tbl') appendTable(item, depth + 1)
      else if (['sdt', 'sdtContent', 'ins', 'customXml'].includes(item.localName)) appendContent(item, depth + 1)
    }
  }
  const appendTable = (node: Element, depth: number) => {
    const rows = children(node, 'tr'), grid = child(node, 'tblGrid'), widths = grid ? children(grid, 'gridCol').map(col => numeric(attr(col, 'w'), 1500) / 15) : []
    const columnCount = widths.length || Math.max(1, ...rows.map(row => children(row, 'tc').length))
    if (columnCount > 100 || rows.length > 2000) throw new Error('文档表格过大，无法预览。')
    const properties = child(node, 'tblPr'), id = `table-${Object.keys(tableSource).length}`, startIndex = body.dataStream.length
    const table: ITable = { tableId: id, tableColumns: Array.from({ length: columnCount }, (_, index) => ({ size: { type: TableSizeType.SPECIFIED, width: { v: widths[index] ?? contentWidth / columnCount } } })), tableRows: [],
      align: attr(child(properties, 'jc'), 'val') === 'center' ? TableAlignmentType.CENTER : TableAlignmentType.START,
      indent: { v: numeric(attr(child(properties, 'tblInd'), 'w')) / 15 }, textWrap: TableTextWrapType.NONE,
      position: { positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 0 }, positionV: { relativeFrom: ObjectRelativeFromV.PAGE, posOffset: 0 } },
      dist: { distB: 0, distL: 0, distR: 0, distT: 0 }, size: { type: TableSizeType.UNSPECIFIED, width: { v: contentWidth } },
      cellMargin: { start: { v: 6 }, end: { v: 6 }, top: { v: 4 }, bottom: { v: 4 } },
    }
    tableSource[id] = table
    body.dataStream += Token.TABLE_START
    for (const row of rows) {
      body.dataStream += Token.TABLE_ROW_START
      const cells: ITableCell[] = []
      for (const cell of children(row, 'tc')) {
        const p = child(cell, 'tcPr'), border = child(p, 'tcBorders') ?? child(properties, 'tblBorders')
        const metadata: ITableCell = { columnSpan: Math.max(1, numeric(attr(child(p, 'gridSpan'), 'val'), 1)) }
        const background = rgb(attr(child(p, 'shd'), 'fill')); if (background) metadata.backgroundColor = { rgb: background }
        for (const [edge, key] of [['top', 'borderTop'], ['bottom', 'borderBottom'], ['left', 'borderLeft'], ['right', 'borderRight']] as const) {
          const definition = child(border, edge) ?? child(border, edge === 'top' || edge === 'bottom' ? 'insideH' : 'insideV')
          if (definition && !['nil', 'none'].includes(attr(definition, 'val') ?? '')) metadata[key] = { color: { rgb: rgb(attr(definition, 'color')) ?? '#777777' }, width: { v: numeric(attr(definition, 'sz'), 4) / 6 } }
        }
        cells.push(metadata)
        body.dataStream += Token.TABLE_CELL_START
        const before = body.dataStream.length
        appendContent(cell, depth)
        if (body.dataStream.length === before || !body.dataStream.endsWith('\r')) {
          body.paragraphs!.push({ paragraphId: `p-${body.paragraphs!.length}`, startIndex: body.dataStream.length }); body.dataStream += '\r'
        }
        sectionBreak(); body.dataStream += Token.TABLE_CELL_END
      }
      const height = child(child(row, 'trPr'), 'trHeight')
      table.tableRows.push({ tableCells: cells, trHeight: { hRule: TableRowHeightRule.AUTO, val: { v: numeric(attr(height, 'val')) / 15 } } })
      body.dataStream += Token.TABLE_ROW_END
    }
    body.dataStream += Token.TABLE_END
    body.tables!.push({ tableId: id, startIndex, endIndex: body.dataStream.length })
  }
  const documentBody = descendants(doc, 'body')[0]
  if (!documentBody) throw new Error('文档缺少正文，无法预览。')
  appendContent(documentBody)
  if (!body.dataStream) { body.dataStream = '\r'; body.paragraphs!.push({ paragraphId: 'p-0', startIndex: 0 }) }
  if (!body.dataStream.endsWith('\r')) { body.paragraphs!.push({ paragraphId: `p-${body.paragraphs!.length}`, startIndex: body.dataStream.length }); body.dataStream += '\r' }
  sectionBreak()
  return { data: { id, title, locale: LocaleType.ZH_CN, body, tableSource, drawings, drawingsOrder: Object.keys(drawings),
    documentStyle: {
      documentFlavor: DocumentFlavor.TRADITIONAL,
      defaultParagraphStyle: { lineSpacing: 1.15, spaceBelow: { v: 6 }, ...paragraphStyle(defaults ? descendants(defaults, 'pPr')[0] : undefined), ...base.paragraph },
      pageSize: { width: numeric(attr(size, 'w'), 11906) / 15, height: numeric(attr(size, 'h'), 16838) / 15 },
      marginTop: numeric(attr(margins, 'top'), 1440) / 15, marginBottom: numeric(attr(margins, 'bottom'), 1440) / 15,
      marginLeft: numeric(attr(margins, 'left'), 1440) / 15, marginRight: numeric(attr(margins, 'right'), 1440) / 15,
      textStyle: { ff: 'Arial', fs: 11, ...runStyle(defaults ? descendants(defaults, 'rPr')[0] : undefined), ...base.run },
    },
  }, warnings }
}
