import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeStore } from '../src/knowledge/store.ts'
import { KnowledgeEngine, type KnowledgeAdapters } from '../src/knowledge/engine.ts'
import { parseCode, codeGraph, readCode, indexLocalWorkspace, searchLocalCode } from '../src/knowledge/code-index.ts'
import { knowledgeRequestSchema } from '../src/knowledge-contract.ts'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
function store(path = ':memory:') { const value = new KnowledgeStore(path); cleanup.push(() => value.close()); return value }
const manual = { kind: 'manual' as const, label: '用户记录' }
const document = { id: 'rule', kind: 'memory' as const, title: '代码查找', body: '身份认证使用 getUserToken 函数', sources: [manual], state: 'active' as const, manual: true }
async function temporary() { const dir = await mkdtemp(join(tmpdir(),'ling-knowledge-')); cleanup.push(() => rm(dir, { recursive: true, force: true })); return dir }
async function waitFor(engine: KnowledgeEngine, id: string) {
  const deadline = Date.now()+5000
  while (Date.now() < deadline) {
    const job = engine.store.job('project',id)
    if (job && !['queued','running'].includes(job.status)) return job
    await new Promise(done => setTimeout(done,10))
  }
  throw new Error('job did not finish')
}
function adapters(root: string): KnowledgeAdapters {
  return { scope: async workspaceId => { if (workspaceId !== 'project') throw new Error('wrong workspace'); return { id:'project',workspaceId,root,label:'项目' } },
    session: async () => ({ id:'session',title:'测试',throughSeq:10,sources:[{kind:'session',label:'原消息',sessionId:'session',seq:2,throughSeq:10}],text:'[event 2 user/message] 请用 pnpm\n[event 10 turn/end] outcome=failed' }),
    history: async () => [], source: async () => ({text:'原文',stale:false}),
    generate: async () => JSON.stringify({ title:'本次任务',summary:'任务未完成。',memories:[{title:'包管理器',body:'使用 pnpm',seqs:[2]}] }),
  }
}

describe('knowledge durability and provenance', () => {
  it('finds Chinese substrings and split identifiers, keeps scope and revisions independent', () => {
    const db = store(); const one = db.put('a',document)
    expect(db.search('a','认证')[0]?.id).toBe('rule')
    expect(db.search('a','身份认证')[0]?.id).toBe('rule')
    expect(db.search('a','getusertoken')[0]?.id).toBe('rule')
    expect(db.search('a','user token')[0]?.id).toBe('rule')
    expect(db.search('a','getUserToken')[0]?.id).toBe('rule')
    expect(db.search('b','认证')).toEqual([])
    expect(db.read('b','rule')).toBeUndefined()
    expect(() => db.put('b',document)).toThrow('不属于')
    expect(() => db.put('a',{...document,body:'新版本',version:100})).toThrow('已更新')
    db.put('a',{...one,body:'明确修正'})
    expect(db.versions('a','rule').map(doc => doc.body)).toEqual(['明确修正',document.body])
    db.remove('a','rule',2)
    expect(db.search('a','明确修正')).toEqual([])
    expect(db.versions('a','rule')).toHaveLength(3)
  })
  it('keeps hand-written Wiki, proposes updates, and rejects approvals after concurrent edits', async () => {
    const db = store(); db.put('project',{...document,id:'wiki',kind:'wiki',body:'人工文档'})
    const proposal = db.generated('project',{...document,id:'wiki',kind:'wiki',body:'新的自动文档',state:'active'})
    expect(db.read('project','wiki')?.body).toBe('人工文档')
    expect(proposal.state).toBe('candidate')
    const engine = new KnowledgeEngine(db,adapters('/unused'))
    const response = await engine.request({ type:'save',workspaceId:'project',document:{ id:proposal.id,version:proposal.version,kind:'wiki',title:proposal.title,body:proposal.body,sources:proposal.sources,state:'active' } })
    expect(response.document?.id).toBe('wiki')
    expect(db.read('project','wiki')?.body).toBe('新的自动文档')
    expect(db.read('project',proposal.id)?.state).toBe('archived')
    const newer = db.generated('project',{...document,id:'wiki',kind:'wiki',body:'另一个自动版本',state:'active'})
    const target = db.read('project','wiki')!; db.put('project',{...target,body:'并发修改'})
    await expect(engine.request({ type:'save',workspaceId:'project',document:{ id:newer.id,version:newer.version,kind:'wiki',title:newer.title,body:newer.body,sources:newer.sources,state:'active' } })).rejects.toThrow('原内容已更新')
  })
  it('restarts interrupted jobs and preserves content across reopen', async () => {
    const home = await temporary(), path=join(home,'knowledge.sqlite')
    const first = new KnowledgeStore(path); first.put('project',document)
    const job = first.enqueue('project','index',{workspaceId:'project'},'stable-job'); first.updateJob(job.id,'running'); first.close()
    const second = store(path)
    expect(second.read('project','rule')?.body).toBe(document.body)
    expect(second.job('project','stable-job')?.status).toBe('queued')
    second.enqueue('project','index',{workspaceId:'project'},'stable-job')
    expect(second.jobs()).toHaveLength(1)
  })
  it('marks generated evidence stale when indexed files change, leaving manual text intact', async () => {
    const db=store(), file=await parseCode('src/a.ts','export function hello() {}')
    db.replaceFiles('project',[file]); db.put('project',{...document,sources:[file.nodes[0]!.source!]})
    db.replaceFiles('project',[await parseCode('src/a.ts','export function goodbye() {}')])
    expect(db.read('project','rule')).toMatchObject({state:'stale',body:document.body,manual:true})
  })
})

describe('code evidence', () => {
  it('loads shipped WASM grammars and preserves symbol and import line references', async () => {
    const ts=await parseCode('src/a.ts',"import { b } from './b'\nexport function hello() { return b() }\nconst arrow = () => hello()")
    const go=await parseCode('main.go','package main\nfunc greet() {}\nfunc main() { greet() }')
    expect(ts.nodes.find(node=>node.label==='hello')?.source).toMatchObject({path:'src/a.ts',line:2,endLine:2})
    expect(ts.nodes.find(node=>node.label==='arrow')).toBeDefined()
    expect(go.nodes.find(node=>node.label==='greet')).toBeDefined()
    const graph=codeGraph([ts,await parseCode('src/b.ts','export function b() {}'),go])
    expect(graph.edges.find(edge=>edge.kind==='imports')).toMatchObject({source:'file:src/a.ts',target:'file:src/b.ts',evidence:'syntax'})
    expect(graph.edges.filter(edge=>edge.kind==='calls').every(edge=>edge.evidence==='syntax')).toBe(true)
  })
  it('indexes a real workspace without following external links or reading secrets', async () => {
    const root=await temporary(), outside=await temporary()
    await mkdir(join(root,'src')); await writeFile(join(root,'src','a.ts'),'export function getToken() {}')
    await writeFile(join(root,'.env'),'KEY=secret'); await writeFile(join(root,'credentials.json'),'secret')
    await writeFile(join(outside,'private.ts'),'secret'); await symlink(join(outside,'private.ts'),join(root,'src','leak.ts'))
    await expect(readCode(root,'src/leak.ts')).rejects.toThrow('不属于')
    await expect(readCode(root,'../private.ts')).rejects.toThrow()
    const files=await indexLocalWorkspace(root,[],new AbortController().signal)
    expect(files.map(file=>file.path)).toEqual(['src/a.ts'])
    expect((await searchLocalCode(root,'getToken'))[0]?.source).toMatchObject({path:'src/a.ts',line:1})
  })
})

describe('background knowledge jobs', () => {
  it('summarizes with original source seqs and extracts candidate memories only, idempotently', async () => {
    const root=await temporary(), db=store(); db.setMeta('settings',{...db.settings(),provider:'test',model:'test'})
    const deps=adapters(root), generate=vi.spyOn(deps,'generate'), engine=new KnowledgeEngine(db,deps)
    await engine.scheduleSummary('project','session',10)
    const id='summary:project:session:10'; expect((await waitFor(engine,id)).status).toBe('completed')
    expect(db.list('project').find(doc=>doc.kind==='summary')).toMatchObject({body:'任务未完成。',sources:[{kind:'session',seq:2,throughSeq:10,label:'原消息',sessionId:'session'}]})
    expect(db.list('project').find(doc=>doc.kind==='memory')?.state).toBe('candidate')
    await engine.scheduleSummary('project','session',10); await new Promise(done=>setTimeout(done,20)); expect(generate).toHaveBeenCalledTimes(1)
  })
  it('does not commit a cancelled model operation or let it overwrite an immediate retry', async () => {
    const root=await temporary(), db=store(); db.setMeta('settings',{...db.settings(),provider:'test',model:'test'})
    let started!:()=>void, finishCancelled!:()=>void; const ready=new Promise<void>(done=>started=done), deps=adapters(root)
    deps.generate=async ()=>{ started(); await new Promise<void>((_resolve,reject)=> { finishCancelled=()=>reject(new Error('aborted')) }); return '' }
    const engine=new KnowledgeEngine(db,deps), response=await engine.request({type:'summarize',workspaceId:'project',sessionId:'session'})
    await ready; await engine.request({type:'cancel',workspaceId:'project',jobId:response.job!.id})
    expect(db.list('project')).toEqual([])
    deps.generate=adapters(root).generate
    await engine.request({type:'retry',workspaceId:'project',jobId:response.job!.id})
    expect(db.job('project',response.job!.id)?.status).toBe('queued')
    finishCancelled()
    expect((await waitFor(engine,response.job!.id)).status).toBe('completed')
  })
  it('validates remote input and never accepts raw query code or oversized source arrays', () => {
    expect(knowledgeRequestSchema.safeParse({type:'search',workspaceId:null,query:'认证'}).success).toBe(true)
    expect(knowledgeRequestSchema.safeParse({type:'search',workspaceId:null,query:'a',sql:'DROP TABLE documents'}).success).toBe(false)
    expect(knowledgeRequestSchema.safeParse({type:'source',workspaceId:'project',source:{kind:'session',label:'bad',seq:-1}}).success).toBe(false)
  })
})
