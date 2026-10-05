import ExcelJS from 'exceljs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

export function officeZip(parts: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries({ '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>', ...parts }).map(([path, content]) => [path, typeof content === 'string' ? strToU8(content) : content])))
}
export function sampleDocx(): Uint8Array {
  return officeZip({
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>项目预览 · LING</w:t></w:r></w:p>
      <w:p><w:r><w:t>Office 文档在右侧阅读，原文件保持不变。</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/><w:color w:val="26734D"/></w:rPr><w:t>只读内容</w:t></w:r><w:del><w:r><w:t>已删除的修订</w:t></w:r></w:del></w:p>
      <w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:bottom w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4200"/><w:gridCol w:w="4200"/></w:tblGrid>
        <w:tr><w:tc><w:tcPr><w:shd w:fill="E4EEE8"/></w:tcPr><w:p><w:r><w:t>格式</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>预览内容</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>Word</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>正文、表格和图片</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
      <w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><wp:docPr id="1" name="示意图片"/><a:graphic><a:graphicData><a:blip r:embed="image1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:left="720" w:bottom="720" w:right="720"/></w:sectPr>
    </w:body></w:document>`,
    'word/styles.xml': `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style></w:styles>`,
    'word/_rels/document.xml.rels': '<Relationships><Relationship Id="image1" Target="media/image1.png"/></Relationships>',
    'word/media/image1.png': Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAEklEQVR4nGNwL4n9jw8z0F4BAB4zQuFkAeLTAAAAAElFTkSuQmCC'), value => value.charCodeAt(0)),
  })
}
export function samplePptx(): Uint8Array {
  return officeZip({
    'ppt/presentation.xml': `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
    ...Object.fromEntries([1, 2].map(index => [`ppt/slides/slide${index}.xml`, `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F3F7F5"/></a:solidFill></p:bgPr></p:bg><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="571500" y="571500"/><a:ext cx="8001000" cy="1905000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr><p:txBody><a:p><a:r><a:rPr sz="3200" b="1"/><a:t>LING · 幻灯片 ${index}</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`])),
  })
}
export function samplePptxWithLayout(): Uint8Array {
  const parts = unzipSync(samplePptx())
  parts['ppt/slides/slide1.xml'] = strToU8(strFromU8(parts['ppt/slides/slide1.xml']!).replace(/<a:xfrm>[\s\S]*?<\/a:xfrm>/, '').replace('<p:sp>', '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>').replace('<a:rPr sz="3200" b="1"/>', '<a:rPr/>'))
  return officeZip({ ...parts,
    'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Id="layout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
    'ppt/slideLayouts/slideLayout1.xml': '<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sldLayout>',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': '<Relationships><Relationship Id="master" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
    'ppt/slideMasters/slideMaster1.xml': '<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="571500" y="571500"/><a:ext cx="8001000" cy="1905000"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4000" b="1"/></a:lvl1pPr></p:titleStyle></p:txStyles></p:sldMaster>',
  })
}
export async function sampleXlsx(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('项目计划')
  sheet.columns = [{ width: 24 }, { width: 14 }, { width: 14 }]
  sheet.addRows([['任务', '工时', '状态'], ['Office 预览', 8, '进行中'], ['只读验证', 3, '已完成']])
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF47745D' } }
  sheet.getCell('B4').value = { formula: 'SUM(B2:B3)', result: 11 }
  sheet.getCell('A5').value = new Date('2026-10-05T00:00:00Z'); sheet.getCell('A5').numFmt = 'yyyy-mm-dd'
  sheet.mergeCells('A6:C6'); sheet.getCell('A6').value = '合并单元格'
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  workbook.addWorksheet('备注').getCell('A1').value = '第二张工作表'
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
