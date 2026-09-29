import type { IBuffer, IBufferCellPosition, ILink } from '@xterm/xterm'

/** Reconstruct wrapped rows using cell widths, so CJK and emoji do not shift hit areas. */
export function terminalLinks(buffer: IBuffer, row: number, activate: ILink['activate']): ILink[] {
  let first = row - 1
  while (first > 0 && row - first < 64 && buffer.getLine(first)?.isWrapped) first--
  let last = row - 1
  while (last + 1 < buffer.length && last - first < 64 && buffer.getLine(last + 1)?.isWrapped) last++
  let text = ''
  const positions: IBufferCellPosition[] = []
  for (let y = first; y <= last; y++) {
    const line = buffer.getLine(y)
    if (!line) continue
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x)
      if (!cell || cell.getWidth() === 0) continue
      const chars = cell.getChars() || ' '
      text += chars
      for (let index = 0; index < chars.length; index++) positions.push({ x: x + 1, y: y + 1 })
    }
  }
  return [...text.matchAll(/https?:\/\/[^\s<>"'`]+/gu)].flatMap(match => {
    let url = match[0].replace(/[.,;:!?。，；！]+$/u, '')
    while (url.endsWith(')') && (url.match(/\)/gu)?.length ?? 0) > (url.match(/\(/gu)?.length ?? 0)) url = url.slice(0, -1)
    try { const parsed = new URL(url); if (parsed.username || parsed.password) return [] } catch { return [] }
    const start = positions[match.index], end = positions[match.index + url.length - 1]
    if (!start || !end || start.y > row || end.y < row) return []
    return [{ text: url, range: { start, end }, activate }]
  })
}
