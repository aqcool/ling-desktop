/** Poll fast only while work is running; foreground/focus resumes immediately. */
export function pollKnowledge(load: (signal: AbortSignal) => Promise<boolean>, idle = 30000) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined, loading = false
  const schedule = (active: boolean) => {
    clearTimeout(timer)
    if (!controller.signal.aborted && !document.hidden)
      timer = setTimeout(() => { void run() }, active ? 3000 : idle)
  }
  const run = async () => {
    if (loading || controller.signal.aborted || document.hidden) return
    clearTimeout(timer)
    loading = true
    let active = false
    try { active = await load(controller.signal) }
    finally { loading = false; schedule(active) }
  }
  const resume = () => { clearTimeout(timer); void run() }
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('focus', resume)
  void run()
  return () => {
    controller.abort()
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', resume)
    window.removeEventListener('focus', resume)
  }
}
