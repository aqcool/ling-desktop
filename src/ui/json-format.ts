const MAX_FORMATTED_BYTES = 1024 * 1024

/** Validate JSON, then format its original tokens so integers, escapes and duplicate keys survive. */
export function formatJson(source: string): string {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const text = bom ? source.slice(1) : source
  try { JSON.parse(text) } catch { throw new Error('JSON 格式有误，未修改内容。') }
  const tokens = text.match(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/gu) ?? []
  const newline = text.includes('\r\n') && !/(?<!\r)\n/u.test(text) ? '\r\n' : '\n'
  const output: string[] = [bom]
  let depth = 0, length = bom.length
  const append = (value: string) => {
    length += value.length
    if (length > MAX_FORMATTED_BYTES) throw new Error('格式化后的 JSON 超过 1 MB，未修改内容。')
    output.push(value)
  }
  const line = () => append(newline + '  '.repeat(depth))
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token === '{' || token === '[') {
      append(token)
      if (tokens[index + 1] === (token === '{' ? '}' : ']')) append(tokens[++index]!)
      else { depth += 1; line() }
    } else if (token === '}' || token === ']') {
      depth -= 1; line(); append(token)
    } else if (token === ',') { append(token); line() }
    else if (token === ':') append(': ')
    else append(token)
  }
  if (/\r?\n[ \t]*$/u.test(text)) append(newline)
  const formatted = output.join('')
  if (new TextEncoder().encode(formatted).byteLength > MAX_FORMATTED_BYTES) throw new Error('格式化后的 JSON 超过 1 MB，未修改内容。')
  return formatted
}
