import { useState } from 'react'
import { createOfflineRuntimeAdapter } from './runtime/offline-adapter.js'
import type { LingRuntimeAdapter } from './runtime/contract.js'
import { useLingRuntime } from './runtime/use-ling-runtime.js'
import { LingShell } from './ui/LingShell.js'
import type { LingUiSlots } from './ui/slots.js'

const offlineRuntime = createOfflineRuntimeAdapter('LING 暂时无法连接。')

interface AppProps {
  readonly runtime?: LingRuntimeAdapter
  readonly slots?: LingUiSlots
}

export function App({ runtime = offlineRuntime, slots }: AppProps) {
  const [environmentOpen, setEnvironmentOpen] = useState(true)
  const [notice, setNotice] = useState('')
  const [prompt, setPrompt] = useState('')
  const model = useLingRuntime(runtime)

  const startNewTask = () => {
    model.startNewTask()
    setNotice('')
    setPrompt('')
  }

  const submit = async () => {
    const text = prompt.trim()
    if (!text) return
    const result = await model.submit(text)
    setNotice(result.accepted ? '' : result.message)
    if (result.accepted) setPrompt('')
  }

  const reconnect = async () => {
    const result = await model.reconnect()
    setNotice(result.accepted ? '正在重新连接…' : result.message)
  }

  return (
    <LingShell
      connection={model.connection}
      environmentOpen={environmentOpen}
      notice={notice}
      onEnvironmentToggle={() => { setEnvironmentOpen(current => !current) }}
      onNewTask={startNewTask}
      onPromptChange={value => { setPrompt(value); setNotice('') }}
      onReconnect={() => { void reconnect() }}
      onSelectTask={model.selectTask}
      onSubmit={() => { void submit() }}
      prompt={prompt}
      selectedTask={model.selectedTask}
      slots={slots}
      tasks={model.tasks}
      timeline={model.timeline}
      workspaces={model.workspaces}
    />
  )
}
