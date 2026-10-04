import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseBehavior } from '../src/ui/behavior-preferences.js'
import { BehaviorSettings } from '../src/ui/BehaviorSettings.js'
import { suggestionReply } from '../src/ui/ReplySuggestions.js'
import { displayTimeline } from '../src/ui/Conversation.js'
import { deliveryName, DeliveryCards } from '../src/ui/DeliveryCards.js'
import type { LingTimelineItem } from '../src/runtime/contract.js'
const user: LingTimelineItem = {taskId:'test', itemId:'user', kind:'user-message', seq:0, text:'认证在哪？', status:'completed', createdAt:'2026-10-04T00:00:00Z'}
const reply: LingTimelineItem = {...user, itemId:'reply', kind:'assistant-message', seq:1, text:'入口在 auth.ts', turnComplete:true}
describe('reply feature settings and presentation', () => {
  it('defaults to right preview and no extra model request, validates and restores saved choices', () => {
    expect(parseBehavior(null)).toMatchObject({artifactOpen:'right', promptSuggestions:false})
    expect(parseBehavior('{"artifactOpen":"invalid","promptSuggestions":"true"}')).toMatchObject({artifactOpen:'right', promptSuggestions:false})
    expect(parseBehavior('{"artifactOpen":"system","promptSuggestions":true}')).toMatchObject({artifactOpen:'system', promptSuggestions:true})
    const html = renderToStaticMarkup(createElement(BehaviorSettings, {section:'general'}))
    expect(html).toContain('aria-label="产物文件默认打开位置"')
    expect(html).toContain('aria-label="提示建议"')
    expect(html).toContain('额外模型请求')
    for (const label of ['产物文件默认打开位置', '提示建议']) {
      const control = html.match(new RegExp(`<[^>]*aria-label="${label}"[^>]*>`))![0]
      expect(control).not.toContain('disabled')
    }
  })
  it('offers suggestions only for the latest completed response, never during execution or after failure', () => {
    expect(suggestionReply([user, reply],false)).toBe(reply)
    expect(suggestionReply([user, reply],true)).toBeUndefined()
    expect(suggestionReply([user, {...reply,turnComplete:false}],false)).toBeUndefined()
    expect(suggestionReply([user, {...reply,status:'failed'}],false)).toBeUndefined()
    expect(suggestionReply([user, reply,{...user,itemId:'next'}],false)).toBeUndefined()
    expect(suggestionReply([user, reply,{...user,itemId:'error',kind:'system-notice',status:'failed'}],false)).toBeUndefined()
  })
  it('keeps delivered files outside collapsed processes even without final text', () => {
    const delivery: LingTimelineItem = {...reply,kind:'system-notice',text:'',presentedFiles:[{seq:1,index:0,path:'report.pdf'}]}
    const groups = displayTimeline([user, delivery],false,true)
    expect(groups.find(group=>group.items.includes(delivery))?.process).toBe(false)
    const html=renderToStaticMarkup(createElement(DeliveryCards,{taskId:'test', files:delivery.presentedFiles!, onOpen:async()=>({ok:true as const,value:undefined}),onPreview:()=>{}}))
    expect(html).toContain('打开 report.pdf'); expect(html).toContain('预览 report.pdf')
    expect(deliveryName('C:\\docs\\report.pdf')).toBe('report.pdf')
  })
})
