import ExcelJS from 'exceljs'
import { BorderStyleTypes, DateSystem, HorizontalAlign, LocaleType, VerticalAlign, WrapStrategy, type ICellData, type IStyleData, type IWorkbookData, type IWorksheetData } from '@univerjs/core'
import { descendants, officeXml, attr, rgb, type OfficeArchive } from './ooxml.js'

const borders: Record<string, BorderStyleTypes> = { thin: BorderStyleTypes.THIN, medium: BorderStyleTypes.MEDIUM, thick: BorderStyleTypes.THICK, dotted: BorderStyleTypes.DOTTED, dashed: BorderStyleTypes.DASHED, double: BorderStyleTypes.DOUBLE, hair: BorderStyleTypes.HAIR, dashDot: BorderStyleTypes.DASH_DOT, dashDotDot: BorderStyleTypes.DASH_DOT_DOT, mediumDashed: BorderStyleTypes.MEDIUM_DASHED, mediumDashDot: BorderStyleTypes.MEDIUM_DASH_DOT, mediumDashDotDot: BorderStyleTypes.MEDIUM_DASH_DOT_DOT }
const horizontal: Record<string, HorizontalAlign> = { left: HorizontalAlign.LEFT, center: HorizontalAlign.CENTER, right: HorizontalAlign.RIGHT, justify: HorizontalAlign.JUSTIFIED, distributed: HorizontalAlign.DISTRIBUTED }
const vertical: Record<string, VerticalAlign> = { top: VerticalAlign.TOP, middle: VerticalAlign.MIDDLE, bottom: VerticalAlign.BOTTOM }
function position(address: string): { row: number; column: number } {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(address)
  if (!match) throw new Error('工作表单元格地址无效。')
  let column = 0
  for (const letter of match[1]!.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64
  return { row: Number(match[2]) - 1, column: column - 1 }
}
function serialDate(date: Date, date1904: boolean): number {
  const serial = date.getTime() / 86400000 + (date1904 ? 24107 : 25569)
  return !date1904 && serial < 61 ? serial - 1 : serial
}

export async function xlsxPreview(bytes: Uint8Array, archive: OfficeArchive, name: string): Promise<{ data: IWorkbookData; warnings: string[] }> {
  // Only stored formula results are shown. The preview does not recalculate or execute formulas.
  const source = new ExcelJS.Workbook()
  await source.xlsx.load(bytes as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0])
  if (source.worksheets.length > 100) throw new Error('工作表数量过多，无法预览。')
  const theme = officeXml(archive, 'xl/theme/theme1.xml', true)
  const scheme = theme ? descendants(theme, 'clrScheme')[0] : undefined
  const colors = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(name => {
    const item = scheme ? descendants(scheme, name)[0]?.firstElementChild : undefined
    return rgb(attr(item ?? undefined, 'val')) ?? rgb(attr(item ?? undefined, 'lastClr'))
  })
  const color = (value: (Partial<ExcelJS.Color> & { tint?: number }) | undefined): string | undefined => {
    if (!value) return
    const hex = value.argb ? rgb(value.argb.slice(-6)) : value.theme === undefined ? undefined : colors[value.theme]
    if (!hex || !value.tint) return hex
    const tinted = [1, 3, 5].map(offset => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16)
      return Math.round(value.tint! < 0 ? channel * (1 + value.tint!) : channel + (255 - channel) * value.tint!).toString(16).padStart(2, '0')
    })
    return `#${tinted.join('')}`
  }
  const style = (value: Partial<ExcelJS.Style>): IStyleData => {
    const result: IStyleData = {}
    if (value.font) {
      result.ff = value.font.name; result.fs = value.font.size
      result.bl = value.font.bold ? 1 : 0; result.it = value.font.italic ? 1 : 0
      if (value.font.underline) result.ul = { s: 1 }
      if (value.font.strike) result.st = { s: 1 }
      if (color(value.font.color)) result.cl = { rgb: color(value.font.color) }
    }
    if (value.numFmt) result.n = { pattern: value.numFmt }
    if (value.fill?.type === 'pattern' && value.fill.pattern === 'solid') result.bg = { rgb: color(value.fill.fgColor) }
    if (value.alignment) {
      result.ht = horizontal[value.alignment.horizontal ?? '']
      result.vt = vertical[value.alignment.vertical ?? '']
      result.tb = value.alignment.wrapText ? WrapStrategy.WRAP : WrapStrategy.OVERFLOW
    }
    if (value.border) {
      result.bd = {}
      for (const [edge, key] of [['top', 't'], ['right', 'r'], ['bottom', 'b'], ['left', 'l']] as const) {
        const border = value.border[edge]
        if (border?.style && borders[border.style] !== undefined) result.bd[key] = { s: borders[border.style]!, cl: { rgb: color(border.color) ?? '#000000' } }
      }
    }
    return result
  }
  const warnings: string[] = []
  let missingResults = false, count = 0
  const sheets: IWorkbookData['sheets'] = {}, sheetOrder: string[] = []
  for (const worksheet of source.worksheets) {
    const id = `sheet-${worksheet.id}`
    sheetOrder.push(id)
    if (worksheet.rowCount > 100_000 || worksheet.columnCount > 4096) throw new Error('工作表范围过大，无法预览。')
    const cellData: IWorksheetData['cellData'] = {}, rowData: IWorksheetData['rowData'] = {}, columnData: IWorksheetData['columnData'] = {}
    worksheet.eachRow((row, rowNumber) => {
      if (row.height || row.hidden) rowData[rowNumber - 1] = { h: row.height ? row.height * 4 / 3 : undefined, hd: row.hidden ? 1 : 0 }
      row.eachCell((cell, columnNumber) => {
        if (++count > 200_000) throw new Error('单元格数量过多，无法预览。')
        const rowIndex = rowNumber - 1, columnIndex = columnNumber - 1
        let value = cell.value
        if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
          if (value.result === undefined) missingResults = true
          value = value.result ?? '—'
        }
        const target: ICellData = { s: style(cell.style) }
        if (value instanceof Date) { target.v = serialDate(value, source.properties.date1904); target.t = 2 }
        else if (typeof value === 'number') { target.v = value; target.t = 2 }
        else if (typeof value === 'boolean') { target.v = value ? 1 : 0; target.t = 3 }
        else if (value && typeof value === 'object' && 'error' in value) { target.v = value.error; target.t = 4 }
        else { target.v = cell.text; target.t = 1 }
        // A cached formula result must not be replaced by cell.text's formula representation.
        if (typeof value === 'string') target.v = value
        cellData[rowIndex] ??= {}
        cellData[rowIndex]![columnIndex] = target
      })
    })
    // ExcelJS returns null column definitions for a valid, completely blank sheet.
    ;(worksheet.columns ?? []).forEach((column, index) => { if (column.width || column.hidden) columnData[index] = { w: column.width ? Math.round(column.width * 7 + 5) : undefined, hd: column.hidden ? 1 : 0 } })
    const frozen = (worksheet.views ?? []).find(view => view.state === 'frozen')
    sheets[id] = { id, name: worksheet.name, cellData, rowData, columnData,
      rowCount: Math.max(worksheet.rowCount, 100), columnCount: Math.max(worksheet.columnCount, 20), defaultRowHeight: 20, defaultColumnWidth: 80,
      hidden: worksheet.state === 'veryHidden' ? 2 : worksheet.state === 'hidden' ? 1 : 0,
      mergeData: (worksheet.model.merges ?? []).map(range => { const [first, last] = range.split(':'); const start = position(first!), end = position(last ?? first!); return { startRow: start.row, endRow: end.row, startColumn: start.column, endColumn: end.column } }),
      ...(frozen?.state === 'frozen' ? { freeze: { xSplit: frozen.xSplit ?? 0, ySplit: frozen.ySplit ?? 0, startRow: frozen.ySplit ?? 0, startColumn: frozen.xSplit ?? 0 } } : {}),
      zoomRatio: 1, showGridlines: worksheet.views?.[0]?.showGridLines === false ? 0 : 1,
    }
  }
  if (!sheetOrder.length) throw new Error('文档中没有工作表。')
  if (missingResults) warnings.push('部分公式没有已保存的计算结果，显示为 —。')
  if (Object.keys(archive).some(path => /^xl\/(?:charts|drawings|pivotTables|externalLinks)\//.test(path))) warnings.push('此工作簿的图表、图片、透视表或外部链接未完整还原。')
  return { data: { id: crypto.randomUUID(), name, appVersion: '1.0.3', locale: LocaleType.ZH_CN, dateSystem: source.properties.date1904 ? DateSystem.Date1904 : DateSystem.Date1900, styles: {}, sheetOrder, sheets }, warnings }
}
