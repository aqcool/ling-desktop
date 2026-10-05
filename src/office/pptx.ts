import { HorizontalAlign, LocaleType, type IDocumentData, type ITextStyle } from '@univerjs/core'
import { BasicShapes, PageElementType, PageType, type IPageElement, type ISlideData, type ISlidePage } from '@univerjs/slides'
import { attr, child, children, descendants, imageSource, numeric, officeXml, relations, rgb, type OfficeArchive } from './ooxml.js'
const emu = (value: string | undefined, fallback = 0) => numeric(value, fallback * 9525) / 9525

/** Preview only authored text, supported shapes and embedded raster images. No scripts or external fetches. */
export function pptxPreview(archive: OfficeArchive, title: string): { data: ISlideData; warnings: string[] } {
  const presentation = officeXml(archive, 'ppt/presentation.xml')!
  const links = relations(archive, 'ppt/presentation.xml')
  const size = descendants(presentation, 'sldSz')[0]
  const pageSize = { width: emu(attr(size, 'cx'), 960), height: emu(attr(size, 'cy'), 540) }
  const theme = officeXml(archive, 'ppt/theme/theme1.xml', true)
  const colors = new Map<string, string>()
  for (const item of theme ? Array.from(descendants(theme, 'clrScheme')[0]?.children ?? []) : []) {
    const value = item.firstElementChild
    const hex = rgb(attr(value ?? undefined, 'val')) ?? rgb(attr(value ?? undefined, 'lastClr'))
    if (hex) colors.set(item.localName, hex)
  }
  const fill = (node: Element | undefined): string | undefined => {
    if (!node) return
    const direct = child(node, 'srgbClr'), themed = child(node, 'schemeClr')
    const key = attr(themed, 'val') ?? ''
    return rgb(attr(direct, 'val')) ?? colors.get(({ bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' } as Record<string, string>)[key] ?? key)
  }
  let incomplete = false
  const textStyle = (node: Element | undefined): ITextStyle => ({
    ...(attr(node, 'sz') ? { fs: numeric(attr(node, 'sz')) / 100 } : {}),
    ...(attr(node, 'b') ? { bl: attr(node, 'b') === '1' ? 1 : 0 } : {}),
    ...(attr(node, 'i') ? { it: attr(node, 'i') === '1' ? 1 : 0 } : {}),
    ...(attr(child(node, 'latin'), 'typeface') ? { ff: attr(child(node, 'latin'), 'typeface') } : {}),
    ...(fill(child(node, 'solidFill')) ? { cl: { rgb: fill(child(node, 'solidFill')) } } : {}),
  })
  const richText = (node: Element, width: number, height: number, defaults: Element[] = []): IDocumentData => {
    const body: NonNullable<IDocumentData['body']> = { dataStream: '', textRuns: [], paragraphs: [] }
    for (const paragraph of children(node, 'p')) {
      const pPr = child(paragraph, 'pPr'), level = Math.max(1, Math.min(9, numeric(attr(pPr, 'lvl')) + 1))
      const inherited = defaults.reduce<ITextStyle>((style, item) => ({ ...style, ...textStyle(child(child(item, `lvl${level}pPr`), 'defRPr')) }), {})
      const base = { ...inherited, ...textStyle(child(pPr, 'defRPr')) }
      const bullet = attr(child(pPr, 'buChar'), 'char')
      if (bullet) body.dataStream += `${bullet} `
      for (const item of Array.from(paragraph.children)) {
        const content = item.localName === 'br' ? '\n' : child(item, 't')?.textContent ?? ''
        if (!content) continue
        const start = body.dataStream.length
        body.dataStream += content
        body.textRuns!.push({ st: start, ed: body.dataStream.length, ts: { ...base, ...textStyle(child(item, 'rPr')) } })
      }
      body.paragraphs!.push({ paragraphId: `p-${body.paragraphs!.length}`, startIndex: body.dataStream.length, paragraphStyle: {
        horizontalAlign: attr(pPr, 'algn') === 'ctr' ? HorizontalAlign.CENTER : attr(pPr, 'algn') === 'r' ? HorizontalAlign.RIGHT : HorizontalAlign.LEFT,
      } })
      body.dataStream += '\r'
    }
    body.sectionBreaks = [{ sectionId: 'section-0', startIndex: body.dataStream.length }]
    body.dataStream += '\n'
    return { id: crypto.randomUUID(), body, documentStyle: { pageSize: { width, height }, marginTop: 4, marginBottom: 4, marginLeft: 6, marginRight: 6, textStyle: { fs: 18, ff: 'Arial' } } }
  }
  const pages: Record<string, ISlidePage> = {}, pageOrder: string[] = []
  const slideIds = descendants(presentation, 'sldId')
  if (slideIds.length > 200) throw new Error('幻灯片数量过多，无法预览。')
  for (const [index, slideId] of slideIds.entries()) {
    const relationId = Array.from(slideId.attributes).find(item => item.localName === 'id' && item.namespaceURI?.includes('relationships'))?.value
    const part = relationId ? links.get(relationId) : undefined
    if (!part) throw new Error('幻灯片内容缺失，无法预览。')
    const slide = officeXml(archive, part)!, slideLinks = relations(archive, part)
    const layoutPart = [...slideLinks.values()].find(path => path.includes('/slideLayouts/'))
    const layout = layoutPart ? officeXml(archive, layoutPart, true) : undefined
    const masterPart = layoutPart ? [...relations(archive, layoutPart).values()].find(path => path.includes('/slideMasters/')) : undefined
    const master = masterPart ? officeXml(archive, masterPart, true) : undefined
    const placeholder = (source: Document | undefined, node: Element) => {
      const ph = descendants(node, 'ph')[0]
      if (!source || !ph) return
      const type = attr(ph, 'type') ?? 'body', index = attr(ph, 'idx')
      const shapes = descendants(source, 'sp').filter(shape => descendants(shape, 'ph').length)
      return shapes.find(shape => index !== undefined && attr(descendants(shape, 'ph')[0], 'idx') === index)
        ?? shapes.find(shape => (attr(descendants(shape, 'ph')[0], 'type') ?? 'body') === type)
    }
    const id = `slide-${index}`, pageElements: Record<string, IPageElement> = {}
    const tree = descendants(slide, 'spTree')[0]
    if (!tree) throw new Error('幻灯片内容无效，无法预览。')
    for (const [order, node] of Array.from(tree.children).entries()) {
      if (['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(node.localName)) continue
      if (!['sp', 'pic'].includes(node.localName)) { incomplete = true; continue }
      const layoutShape = placeholder(layout, node), masterShape = placeholder(master, layoutShape ?? node)
      const properties = child(node, 'spPr'), transform = child(properties, 'xfrm') ?? child(child(layoutShape, 'spPr'), 'xfrm') ?? child(child(masterShape, 'spPr'), 'xfrm')
      if (!transform) { incomplete = true; continue }
      const offset = child(transform, 'off'), extent = child(transform, 'ext')
      const width = emu(attr(extent, 'cx')), height = emu(attr(extent, 'cy'))
      const element: IPageElement = { id: `${id}-element-${order}`, zIndex: order * 2,
        left: emu(attr(offset, 'x')), top: emu(attr(offset, 'y')), width, height,
        angle: numeric(attr(transform, 'rot')) / 60000, flipX: attr(transform, 'flipH') === '1', flipY: attr(transform, 'flipV') === '1',
        title: '', description: '', type: PageElementType.TEXT }
      if (node.localName === 'pic') {
        const embed = attr(descendants(node, 'blip')[0], 'embed')
        const source = imageSource(archive, embed ? slideLinks.get(embed) : undefined)
        if (source) { element.type = PageElementType.IMAGE; element.image = { imageProperties: { contentUrl: source } }; pageElements[element.id] = element }
        else incomplete = true
        if (descendants(node, 'srcRect').length) incomplete = true
        continue
      }
      const geometry = attr(child(properties, 'prstGeom'), 'prst')
      const background = fill(child(properties, 'solidFill')), line = child(properties, 'ln')
      if (background || fill(child(line, 'solidFill'))) {
        const shape = { ...element, id: `${element.id}-shape`, type: PageElementType.SHAPE,
          shape: { shapeType: geometry === 'ellipse' ? BasicShapes.Ellipse : geometry === 'roundRect' ? BasicShapes.RoundRect : BasicShapes.Rect,
            text: '', shapeProperties: { shapeBackgroundFill: { rgb: background ?? 'transparent' },
              ...(fill(child(line, 'solidFill')) ? { outline: { outlineFill: { rgb: fill(child(line, 'solidFill')) }, weight: emu(attr(line, 'w'), 1) } } : {}) } } }
        pageElements[shape.id] = shape
      }
      if (geometry && !['rect', 'roundRect', 'ellipse'].includes(geometry)) incomplete = true
      const body = child(node, 'txBody')
      if (body) {
        const type = attr(descendants(node, 'ph')[0], 'type')
        const masterText = master ? descendants(master, 'txStyles')[0] : undefined
        const defaults = [child(masterText, type === 'title' || type === 'ctrTitle' ? 'titleStyle' : type === 'body' || type === 'subTitle' ? 'bodyStyle' : 'otherStyle'), child(child(masterShape, 'txBody'), 'lstStyle'), child(child(layoutShape, 'txBody'), 'lstStyle'), child(body, 'lstStyle')].filter((item): item is Element => !!item)
        element.zIndex += 1; element.richText = { rich: richText(body, width, height, defaults) }; pageElements[element.id] = element
      }
      if (descendants(node, 'gradFill').length || descendants(node, 'custGeom').length) incomplete = true
    }
    // Basic placeholder positions/text styles are inherited; master graphics,
    // animation and more complex geometry still need a fuller adapter.
    if ([...slideLinks.values()].some(path => path.includes('/slideLayouts/')) || descendants(slide, 'timing').length) incomplete = true
    pageOrder.push(id)
    pages[id] = { id, pageType: PageType.SLIDE, zIndex: index, title: `幻灯片 ${index + 1}`, description: '',
      pageBackgroundFill: { rgb: fill(descendants(slide, 'bgPr')[0] ? child(descendants(slide, 'bgPr')[0], 'solidFill') : undefined) ?? '#FFFFFF' }, pageElements }
  }
  if (!pageOrder.length) throw new Error('文档中没有幻灯片。')
  return { data: { id: crypto.randomUUID(), title, locale: LocaleType.ZH_CN, pageSize, body: { pages, pageOrder } },
    warnings: incomplete ? ['此演示文稿的母版、图表、组合图形或其他复杂排版未完整还原。'] : [] }
}
