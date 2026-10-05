import { describe, expect, it } from 'vitest'
import { formatJson } from '../src/ui/json-format.js'

describe('lossless JSON formatting', () => {
  it('preserves large integers, decimal/exponent lexemes, duplicate keys and escaped strings', () => {
    const source = '{"id":900719925474099312345,"decimal":1.2300,"exponent":1e+999,"key":"\\u0061,{}\\\"","key":null,"empty":[{},[]]}'
    const result = formatJson(source)
    expect(result).toBe('{\n  "id": 900719925474099312345,\n  "decimal": 1.2300,\n  "exponent": 1e+999,\n  "key": "\\u0061,{}\\\"",\n  "key": null,\n  "empty": [\n    {},\n    []\n  ]\n}')
    expect(formatJson(result)).toBe(result)
  })
  it('preserves a BOM, Windows line endings and an existing trailing newline', () => {
    expect(formatJson('\uFEFF{\r\n"items":[true,false]\r\n}\r\n')).toBe('\uFEFF{\r\n  "items": [\r\n    true,\r\n    false\r\n  ]\r\n}\r\n')
    expect(formatJson('  null  ')).toBe('null')
  })
  it.each(['', '{"a":}', '{"a":1,}', '{"a":NaN}', '{/* comment */ "a":1}', '{"a":"bad\nstring"}'])('refuses invalid JSON without producing a replacement: %s', source => {
    expect(() => formatJson(source)).toThrow('JSON 格式有误，未修改内容。')
  })
  it('bounds formatting expansion before a deeply nested or UTF-8 document can exhaust the editor', () => {
    expect(() => formatJson('['.repeat(1200) + '0' + ']'.repeat(1200))).toThrow('超过 1 MB')
    expect(() => formatJson(JSON.stringify('灵'.repeat(350000)))).toThrow('超过 1 MB')
  })
})
