import { Button } from '@heroui/react/button'
import { Card } from '@heroui/react/card'
import { TextArea } from '@heroui/react/textarea'
import { useEffect, useState, type ChangeEvent } from 'react'
import { createOfflineRuntimeAdapter } from './runtime/offline-adapter.js'
import type {
  LingRuntimeAdapter,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
} from './runtime/contract.js'

const offlineRuntime = createOfflineRuntimeAdapter('LING 运行时尚未连接。')

const connectionLabels = {
  offline: '未连接',
  connecting: '正在连接',
  ready: '已连接',
  failed: '连接失败',
} as const

interface AppProps {
  readonly runtime?: LingRuntimeAdapter
}

function requestId() {
  return `renderer-${String(Date.now())}-${Math.random().toString(16).slice(2)}`
}

function applyRuntimeEvent(
  snapshot: LingRuntimeSnapshot | undefined,
  event: LingRuntimeEvent,
): LingRuntimeSnapshot | undefined {
  if (!snapshot) return snapshot

  switch (event.type) {
    case 'snapshot.replaced':
      return event.snapshot
    case 'connection.changed':
      return { ...snapshot, connection: event.connection }
    case 'task.upsert': {
      const taskIndex = snapshot.tasks.findIndex(task => task.taskId === event.task.taskId)
      const tasks = [...snapshot.tasks]

      if (taskIndex === -1) tasks.unshift(event.task)
      else tasks[taskIndex] = event.task

      return { ...snapshot, tasks }
    }
    case 'task.removed':
      return { ...snapshot, tasks: snapshot.tasks.filter(task => task.taskId !== event.taskId) }
    case 'timeline.append':
      return snapshot
  }
}

export function App({ runtime = offlineRuntime }: AppProps) {
  const [snapshot, setSnapshot] = useState<LingRuntimeSnapshot>()
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState('先描述你想完成的工作。')

  useEffect(() => {
    let active = true

    void runtime.getSnapshot().then(nextSnapshot => {
      if (active) setSnapshot(nextSnapshot)
    })

    return () => {
      active = false
    }
  }, [runtime])

  useEffect(() => runtime.subscribe(event => {
    setSnapshot(currentSnapshot => applyRuntimeEvent(currentSnapshot, event))
  }), [runtime])

  const connection = snapshot?.connection ?? {
    phase: 'connecting' as const,
    message: '正在读取 LING 运行时状态…',
  }

  async function beginTask() {
    const taskPrompt = prompt.trim()

    if (!taskPrompt) {
      setNotice('先写下希望 LING 完成的工作。')
      return
    }

    const result = await runtime.dispatch({
      type: 'task.create',
      requestId: requestId(),
      prompt: taskPrompt,
    })

    setNotice(result.accepted ? '任务已交给 LING。' : result.message)
  }

  async function reconnectRuntime() {
    const result = await runtime.dispatch({
      type: 'runtime.reconnect',
      requestId: requestId(),
    })

    setNotice(result.accepted ? '正在重新连接运行时。' : result.message)
  }

  return (
    <div className="ling-app">
      <aside className="signal-rail" aria-label="LING 任务状态">
        <header className="brand-lockup">
          <span className="brand-lockup__mark" aria-hidden="true">L</span>
          <div>
            <p className="brand-lockup__name">LING</p>
            <p className="brand-lockup__descriptor">DESKTOP / ALPHA</p>
          </div>
        </header>

        <section className="signal-map" aria-labelledby="signal-map-title">
          <p id="signal-map-title" className="section-label">工作流</p>
          <ol className="signal-map__steps">
            <li className="signal-map__step signal-map__step--active">
              <span aria-hidden="true" className="signal-map__dot" />
              <div>
                <strong>任务输入</strong>
                <small>准备就绪</small>
              </div>
            </li>
            <li className="signal-map__step">
              <span aria-hidden="true" className="signal-map__dot" />
              <div>
                <strong>运行时</strong>
                <small>{connectionLabels[connection.phase]}</small>
              </div>
            </li>
            <li className="signal-map__step">
              <span aria-hidden="true" className="signal-map__dot" />
              <div>
                <strong>执行轨迹</strong>
                <small>{snapshot?.tasks.length ? `${String(snapshot.tasks.length)} 个任务` : '等待任务'}</small>
              </div>
            </li>
          </ol>
        </section>

        <Card className="runtime-card" variant="secondary">
          <Card.Header>
            <Card.Title>运行时状态</Card.Title>
            <Card.Description>{connection.message ?? connectionLabels[connection.phase]}</Card.Description>
          </Card.Header>
          <Card.Footer>
            <span className={`connection-status connection-status--${connection.phase}`}>
              <span aria-hidden="true" className="connection-status__light" />
              {connectionLabels[connection.phase]}
            </span>
            <Button onPress={() => { void reconnectRuntime() }} size="sm" variant="outline">
              重新连接
            </Button>
          </Card.Footer>
        </Card>
      </aside>

      <main className="task-desk">
        <header className="task-desk__intro">
          <p className="section-label">新建任务</p>
          <h1>把工作交给 LING。</h1>
          <p>
            描述目标、工作区或你希望它先检查的内容。连接完成后，LING 会把每一步执行过程留在这里。
          </p>
        </header>

        <Card className="composer-card" variant="tertiary">
          <Card.Header>
            <Card.Title>从一个清晰的目标开始</Card.Title>
            <Card.Description>例如：检查这个仓库的构建失败原因，并给出可执行的修复方案。</Card.Description>
          </Card.Header>
          <Card.Content>
            <TextArea
              aria-describedby="composer-hint"
              aria-label="任务目标"
              className="composer-card__textarea"
              maxLength={2000}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setPrompt(event.target.value) }}
              placeholder="告诉 LING 你想完成什么…"
              rows={4}
              value={prompt}
              variant="secondary"
            />
            <div className="composer-card__meta">
              <span id="composer-hint">任务会在连接后开始执行。</span>
              <span>{String(prompt.length)} / 2000</span>
            </div>
          </Card.Content>
          <Card.Footer className="composer-card__footer">
            <p aria-live="polite" className="composer-card__notice" role="status">{notice}</p>
            <Button isDisabled={!prompt.trim()} onPress={() => { void beginTask() }}>
              开始任务
            </Button>
          </Card.Footer>
        </Card>

        <section className="empty-trajectory" aria-labelledby="trajectory-title">
          <div>
            <p className="section-label">执行轨迹</p>
            <h2 id="trajectory-title">还没有正在运行的任务</h2>
          </div>
          <p>运行时连接后，代码、浏览器和终端活动会按时间顺序显示在这里。</p>
        </section>
      </main>
    </div>
  )
}
