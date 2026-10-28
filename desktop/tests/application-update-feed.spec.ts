import { describe, expect, it, vi } from 'vitest'
import { configureLingReleaseFeed } from '../src/application-update-feed.ts'

const release = (version: string, extra: object = {}) => ({ tag_name: `ling-v${version}`, draft: false, prerelease: version.includes('-'), body: '修复终端', ...extra })
function fixture(body: unknown, status = 200) {
  const backend = { channel: 'dev', allowDowngrade: true, setFeedURL: vi.fn() }
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  return { backend, fetcher }
}
describe('LING GitHub release feed', () => {
  it('resolves ling-v preview tags by version and pins downloads to the release', async () => {
    const { backend, fetcher } = fixture([release('0.0.0-dev.9'), release('0.0.0-dev.12'), release('0.0.0-dev.11')])
    expect(await configureLingReleaseFeed(backend, 'preview', '0.0.0-dev.11', fetcher)).toEqual({ available: true, releaseNotes: '修复终端' })
    expect(backend.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://github.com/aqcool/ling-desktop/releases/download/ling-v0.0.0-dev.12/', channel: 'dev', useMultipleRangeRequest: false })
    expect(backend.allowDowngrade).toBe(false)
  })
  it('lets preview users receive a newer stable version using latest metadata', async () => {
    const { backend, fetcher } = fixture([release('1.0.0-dev.4'), release('1.0.0')])
    await configureLingReleaseFeed(backend, 'preview', '1.0.0-dev.3', fetcher)
    expect(backend.channel).toBe('latest')
  })
  it('does not fetch metadata from the installed legacy release or downgrade', async () => {
    const { backend, fetcher } = fixture([release('0.0.0-dev.11')])
    expect(await configureLingReleaseFeed(backend, 'preview', '0.0.0-dev.11', fetcher)).toEqual({ available: false })
    expect(backend.setFeedURL).not.toHaveBeenCalled()
  })
  it('ignores drafts, unrelated tags and malformed versions', async () => {
    const { backend, fetcher } = fixture([release('9.0.0', { draft: true }), release('7.0.0', { tag_name: 'v7.0.0' }), release('../latest')])
    expect(await configureLingReleaseFeed(backend, 'preview', '1.0.0', fetcher)).toEqual({ available: false })
  })
  it('accepts beta and rc releases in the preview channel using the published dev feed', async () => {
    const { backend, fetcher } = fixture([release('2.0.0-beta.1'), release('2.0.0-rc.1')])
    expect(await configureLingReleaseFeed(backend, 'preview', '1.0.0', fetcher)).toMatchObject({ available: true })
    expect(backend.setFeedURL).toHaveBeenCalledWith(expect.objectContaining({ channel: 'dev', url: expect.stringContaining('/ling-v2.0.0-rc.1/') }))
  })
  it('looks up the latest stable independently of numerous prereleases', async () => {
    const { backend, fetcher } = fixture(release('2.0.0'))
    await configureLingReleaseFeed(backend, 'stable', '1.0.0', fetcher)
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/aqcool/ling-desktop/releases/latest')
    expect(backend.channel).toBe('latest')
  })
  it('reports no stable release yet but does not hide network or rate limit failures', async () => {
    const missing = fixture({}, 404)
    expect(await configureLingReleaseFeed(missing.backend, 'stable', '1.0.0-dev.1', missing.fetcher)).toEqual({ available: false })
    const limited = fixture({}, 403)
    await expect(configureLingReleaseFeed(limited.backend, 'stable', '1.0.0', limited.fetcher)).rejects.toThrow('403')
    expect(limited.backend.setFeedURL).not.toHaveBeenCalled()
  })
})
