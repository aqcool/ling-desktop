import type { LingApprovalDetails } from 'ling-desktop/runtime'

// The upstream approval carrier exposes a reason string only. Keep this versioned
// envelope at the LING adapter boundary; never put its serialization in the UI.
const prefix = 'ling:approval:v1\n'
export const encodeApprovalDetails = (details: LingApprovalDetails): string => prefix + JSON.stringify(details)

export function decodeApprovalDetails(reason: string | undefined): LingApprovalDetails | undefined {
  if (!reason?.startsWith(prefix) || reason.length > 40000) return
  try {
    const data: unknown = JSON.parse(reason.slice(prefix.length))
    if (!data || typeof data !== 'object') return
    const value = data as Record<string, unknown>
    const fields = ['summary', 'server', 'cwd', 'impact', 'command', 'source', 'destination'] as const
    if (fields.slice(0, 4).some(key => typeof value[key] !== 'string' || !value[key])) return
    if (fields.some(key => value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 16384))) return
    return Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as unknown as LingApprovalDetails
  } catch { return }
}
