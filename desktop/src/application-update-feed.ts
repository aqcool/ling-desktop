import { gt, prerelease, rcompare, valid } from 'semver'
import type { LingUpdateChannel } from 'ling-desktop/runtime'

interface FeedBackend {
  channel: string | null
  allowDowngrade: boolean
  setFeedURL?(options: { provider: 'generic'; url: string; channel: string; useMultipleRangeRequest: boolean }): void
}
interface Release { readonly version: string; readonly tag: string; readonly notes?: string }
const repository = 'https://github.com/aqcool/ling-desktop'
const api = 'https://api.github.com/repos/aqcool/ling-desktop/releases'

/** GitHubProvider only recognizes v-prefixed semver; LING keeps its existing ling-v tags. */
export async function configureLingReleaseFeed(
  backend: FeedBackend, channel: LingUpdateChannel, currentVersion: string,
  fetchRelease: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<{ available: boolean; releaseNotes?: string }> {
  const response = await fetchRelease(channel === 'stable' ? `${api}/latest` : `${api}?per_page=100`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15_000),
  })
  if (channel === 'stable' && response.status === 404) return { available: false }
  if (!response.ok) throw new Error(`Release lookup failed: ${response.status}`)
  const value: unknown = await response.json()
  const entries: unknown[] = channel === 'stable' ? [value] : Array.isArray(value) ? value : []
  if (channel === 'preview' && !Array.isArray(value)) throw new Error('Invalid release list')
  const candidates: Release[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (record.draft !== false || typeof record.tag_name !== 'string' || !record.tag_name.startsWith('ling-v')) continue
    const version = record.tag_name.slice('ling-v'.length)
    if (valid(version) !== version) continue
    const preview = prerelease(version)
    if (channel === 'stable' && (preview !== null || record.prerelease !== false)) continue
    candidates.push({ version, tag: record.tag_name, ...(typeof record.body === 'string' ? { notes: record.body.slice(0, 32_768) } : {}) })
  }
  candidates.sort((a, b) => rcompare(a.version, b.version))
  const release = candidates[0]
  if (!release || !gt(release.version, currentVersion)) return { available: false }
  if (!backend.setFeedURL) throw new Error('Update backend cannot configure feed')
  const feedChannel = prerelease(release.version) ? 'dev' : 'latest'
  backend.setFeedURL({ provider: 'generic', url: `${repository}/releases/download/${release.tag}/`, channel: feedChannel, useMultipleRangeRequest: false })
  backend.channel = feedChannel
  backend.allowDowngrade = false
  return { available: true, ...(release.notes ? { releaseNotes: release.notes } : {}) }
}
