export const quickNotesUrl = 'dsh-app://app/?surface=quick-notes'
export function parseNoteWindowContext(raw: unknown): { taskId: string; title?: string; workspace?: string } | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Quick Notes context')
  const value = raw as Record<string, unknown>
  if (typeof value.taskId !== 'string' || !value.taskId.length || value.taskId.length > 256) throw new Error('Invalid Quick Notes task')
  for (const key of ['title', 'workspace']) if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > 4096)) throw new Error('Invalid Quick Notes label')
  return { taskId: value.taskId, ...(typeof value.title === 'string' ? { title: value.title } : {}), ...(typeof value.workspace === 'string' ? { workspace: value.workspace } : {}) }
}
export function parseNoteWindowAction(raw: unknown): { action: 'attach' | 'source'; id: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Quick Notes action')
  const value = raw as Record<string, unknown>
  if (!['attach', 'source'].includes(value.action as string) || typeof value.id !== 'string' || !value.id.length || value.id.length > 256) throw new Error('Invalid Quick Notes action')
  return { action: value.action as 'attach' | 'source', id: value.id }
}
