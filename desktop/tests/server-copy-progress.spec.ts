import { expect, it } from 'vitest'
import type { CopyProgress } from '../src/server-copy.ts'
import { createCopyProgressReporter } from '../src/server-copy-progress.ts'

it('throttles byte noise without dropping phase changes, 100% or completion', () => {
  const lines: string[] = []
  let now = 0
  const report = createCopyProgressReporter(line => lines.push(line), () => now)
  const value: CopyProgress = { phase: 'scan', copied: 0, skipped: 0, bytes: 0, totalBytes: 200, files: 2 }
  report(value)
  report({ ...value, phase: 'transfer' })
  for (const bytes of [50, 100, 190]) { now += 100; report({ ...value, phase: 'transfer', bytes }) }
  expect(lines).toHaveLength(2)
  report({ ...value, phase: 'transfer', bytes: 200 })
  report({ ...value, phase: 'verify', bytes: 200, verifiedBytes: 0, totalVerifyBytes: 400 })
  report({ ...value, phase: 'verify', bytes: 200, verifiedBytes: 200, totalVerifyBytes: 400 })
  report({ ...value, phase: 'verify', bytes: 200, verifiedBytes: 400, totalVerifyBytes: 400 })
  report({ ...value, phase: 'complete', bytes: 200, verifiedBytes: 400, totalVerifyBytes: 400, copied: 2 })
  expect(lines).toHaveLength(6)
  expect(lines[2]).toContain('已传输 200/200 字节（100%）')
  expect(lines[3]).toContain('正在校验传输内容')
  expect(lines[4]).toContain('已校验 400/400 字节（100%）')
  expect(lines[5]).toContain('拷贝完成 · 已完成 2/2 个文件')
})

it('reports zero-byte verification and separates preflight from transmitted bytes', () => {
  const lines: string[] = []
  const report = createCopyProgressReporter(line => lines.push(line), () => 0)
  const value: CopyProgress = { phase: 'preflight', copied: 0, skipped: 0, bytes: 0, totalBytes: 0, files: 1, verifiedBytes: 0, totalVerifyBytes: 0 }
  report(value)
  report(value)
  report({ ...value, phase: 'complete', skipped: 1 })
  expect(lines).toHaveLength(2)
  expect(lines[0]).toContain('校验已有文件')
  expect(lines[0]).not.toContain('已传输')
  expect(lines.join('')).not.toContain('NaN')
  expect(lines[1]).toContain('跳过 1 个')
})
