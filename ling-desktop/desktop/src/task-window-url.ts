/** Only task deep links from the owned renderer may open another app window. */
export function isTaskWindowUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    const taskId = url.searchParams.get('task')
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && url.pathname === '/'
      && url.username === '' && url.password === '' && url.port === '' && url.hash === ''
      && url.searchParams.size === 1 && taskId !== null && taskId.length > 0 && taskId.length <= 256
  } catch {
    return false
  }
}
