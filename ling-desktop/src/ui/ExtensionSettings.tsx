import { PluginManager } from './PluginManager.js'
import { Button } from '@heroui/react/button'
import { Card } from '@heroui/react/card'
import { Spinner } from '@heroui/react/spinner'
import { useEffect, useState } from 'react'
import type { LingPluginManager, LingReadResult, LingSkill } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

function SkillCard({
  message,
  loading,
  skills,
  taskRequired,
}: {
  readonly message?: string
  readonly loading: boolean
  readonly skills: readonly LingSkill[] | undefined
  readonly taskRequired: boolean
}) {
  return (
    <Card className={tw("settings-card rounded-2xl border border-[#eaeae7] dark:border-[#303035]")} variant="secondary">
      <Card.Header className={tw("px-4.5 pt-3.5 pb-0")}>
        <div>
          <Card.Title className={tw("text-sm font-[620]")}><Icon name="sparkle" size={15} /> 技能</Card.Title>
          <Card.Description className={tw("mt-0.5 text-xs")}>当前任务可用的技能目录。</Card.Description>
        </div>
      </Card.Header>
      <Card.Content className={tw("px-4.5 pt-3 pb-4")}>
        {taskRequired ? <p className={tw("extension-settings__hint dark:[color:#a0a0a6] [margin:0_0_0.6rem] [color:#6f6f6f] [font-size:0.76rem]")}>打开一个任务后可查看技能目录。</p> : null}
        {loading ? <p className={tw("extension-settings__state dark:[color:#a0a0a6] flex items-center [gap:0.45rem] m-0 [color:#6b6b6b] [font-size:0.77rem]")}><Spinner size="sm" /> 正在读取技能目录</p> : null}
        {!loading && message !== undefined ? <p className={tw("extension-settings__state dark:[color:#a0a0a6] flex items-center [gap:0.45rem] m-0 [color:#6b6b6b] [font-size:0.77rem] extension-settings__state--error dark:[color:#e08a80] [color:#a6473f]")}>{message}</p> : null}
        {!loading && skills !== undefined && skills.length === 0 ? <p className={tw("extension-settings__state dark:[color:#a0a0a6] flex items-center [gap:0.45rem] m-0 [color:#6b6b6b] [font-size:0.77rem]")}>此任务没有可用技能。</p> : null}
        {!loading && skills !== undefined && skills.length > 0 ? (
          <ul className={tw("extension-list grid [gap:0.4rem] m-0 p-0 [list-style:none]")}>
            {skills.map(skill => (
              <li className={tw("extension-item dark:[border-color:#34343a] dark:[background:#232327] grid [gap:0.2rem] [padding:0.6rem_0.7rem] [border:1px_solid_#ecece9] [border-radius:0.6rem] [background:#fbfbfa]")} key={`${skill.name}-${String(skill.path ?? '')}`}>
                <div className={tw("extension-item__head flex flex-wrap items-center gap-1.5")}>
                  <b className={tw("text-[0.8rem] font-[620]")}>{skill.name}</b>
                  {skill.modelInvocable ? <span className={tw("extension-item__tag dark:[background:#2a2a2d] dark:[color:#a5a5aa] [padding:0.1rem_0.38rem] [border-radius:0.35rem] [background:#ececea] [color:#5f5f5f] [font-size:0.66rem]")}>模型可调用</span> : null}
                </div>
                <span className={tw("extension-item__desc dark:[color:#c9c9cd] overflow-hidden [color:#6b6b6b] [font-size:0.73rem] [line-height:1.45] text-ellipsis whitespace-nowrap")}>{skill.description}</span>
                {skill.whenToUse !== undefined ? <span className={tw("extension-item__note dark:[color:#c9c9cd] overflow-hidden [color:#6b6b6b] [font-size:0.73rem] [line-height:1.45] text-ellipsis whitespace-nowrap")}>{skill.whenToUse}</span> : null}
                {skill.path !== undefined ? <span className={tw("extension-item__source dark:[color:#8d8d93] overflow-hidden [color:#8a8a8a] [font-size:0.68rem] [line-height:1.45] text-ellipsis whitespace-nowrap [font-family:ui-monospace,_SFMono-Regular,_Menlo,_Monaco,_Consolas,_monospace]")} title={skill.path}>{skill.path}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card.Content>
    </Card>
  )
}

export function ExtensionSettings({ manager, ...props }: {
  manager?: LingPluginManager
  readSkills: (taskId: string, signal: AbortSignal) => Promise<LingReadResult<readonly LingSkill[]>>
  taskId?: string
}) {
  return manager ? <PluginManager service={manager} /> : <SkillSettings {...props} />
}

function SkillSettings({ readSkills, taskId }: {
  readSkills: (taskId: string, signal: AbortSignal) => Promise<LingReadResult<readonly LingSkill[]>>
  taskId?: string
}) {
  const [revision, setRevision] = useState(0)
  const [skills, setSkills] = useState<readonly LingSkill[]>()
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsMessage, setSkillsMessage] = useState<string>()
  useEffect(() => {
    const abort = new AbortController()
    setSkillsLoading(true)
    setSkillsMessage(undefined)
    if (taskId === undefined) {
      setSkills(undefined)
      setSkillsLoading(false)
      return () => { abort.abort() }
    }
    void readSkills(taskId, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) setSkills(result.value)
      else {
        setSkills(undefined)
        setSkillsMessage(result.message)
      }
      setSkillsLoading(false)
    }).catch(() => {
      if (abort.signal.aborted) return
      setSkills(undefined)
      setSkillsMessage('无法读取技能目录。')
      setSkillsLoading(false)
    })
    return () => { abort.abort() }
  }, [readSkills, revision, taskId])

  return <section className={tw('flex flex-col gap-5')} aria-label="扩展设置">
    <header className={tw('flex items-center justify-between')}><h1 className={tw('m-0 text-xl font-semibold')}>扩展管理</h1><Button isIconOnly size="sm" variant="ghost" aria-label="刷新扩展能力" isDisabled={skillsLoading} onPress={() => setRevision(value => value + 1)}><Icon name="refresh" size={16} /></Button></header>
    <SkillCard loading={skillsLoading} message={skillsMessage} skills={skills} taskRequired={taskId === undefined} />
  </section>
}
