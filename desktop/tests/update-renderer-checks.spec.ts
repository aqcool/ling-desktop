import { expect, it, vi } from 'vitest'
import { UpdateRendererChecks } from '../src/update-renderer-checks.ts'

it('waits for the matching renderer and ignores stale or forged acknowledgements', async () => {
  const checks = new UpdateRendererChecks()
  let token = ''
  const done = vi.fn()
  const request = checks.request(7, value => { token = value }).then(done)
  checks.acknowledge(9, token, undefined)
  checks.acknowledge(7, 'stale-token', undefined)
  await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
  checks.acknowledge(7, token, '请先保存文件')
  await request
  expect(done).toHaveBeenCalledWith('请先保存文件')
})

it('fails closed for an unresponsive renderer and treats its late reply as expired', async () => {
  const checks = new UpdateRendererChecks()
  let token = ''
  expect(await checks.request(7, value => { token = value }, 1)).toContain('无法确认')
  checks.acknowledge(7, token, undefined)
  expect(await checks.request(7, value => checks.acknowledge(7, value, undefined))).toBeUndefined()
})

it('rejects malformed or oversized renderer diagnostics', async () => {
  const checks = new UpdateRendererChecks()
  expect(await checks.request(7, token => checks.acknowledge(7, token, {}))).toContain('无法确认')
  expect(await checks.request(7, token => checks.acknowledge(7, token, 'x'.repeat(1000)))).toHaveLength(500)
})

it('preserves a downloaded update when a window closes before the request can be sent', async () => {
  const checks = new UpdateRendererChecks()
  expect(await checks.request(7, () => { throw new Error('WebContents destroyed') })).toContain('窗口已关闭')
})
