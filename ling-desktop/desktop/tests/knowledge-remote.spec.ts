import { describe, expect, it, vi } from 'vitest'
import { DshRemoteRuntime } from '../src/ssh/runtime.ts'
import { remoteFileRequestSchema } from '../src/ssh/contract.ts'
function runtime() {
  const fs={resolve:vi.fn(async(path:string)=>({targetKey:path.includes('escape')?'/outside/private.ts':path})), contains:vi.fn((root:{targetKey:string},target:{targetKey:string})=>target.targetKey===root.targetKey||target.targetKey.startsWith(root.targetKey+'/')),
    readBytes:vi.fn(async()=>new TextEncoder().encode('export function hello() {}')), listDir:vi.fn(async()=>[{name:'safe.ts',target:{targetKey:'/project/safe.ts'},type:'file'},{name:'escape.ts',target:{targetKey:'/outside/private.ts'},type:'file'}])}
  const value=Object.create(DshRemoteRuntime.prototype) as DshRemoteRuntime; Object.assign(value,{ctx:{fs}}); return {value,fs}
}
describe('SSH knowledge filesystem boundary',()=>{
  it('checks canonical containment before reading and applies the byte limit in the remote provider',async()=>{
    const {value,fs}=runtime()
    await expect(value.readFile('/project/escape.ts',undefined,'/project',512*1024)).rejects.toThrow('不属于')
    expect(fs.readBytes).not.toHaveBeenCalled()
    expect(await value.readFile('/project/safe.ts',undefined,'/project',512*1024)).toMatchObject({text:'export function hello() {}',truncated:false})
    expect(fs.readBytes).toHaveBeenCalledWith({targetKey:'/project/safe.ts'},undefined,512*1024)
  })
  it('does not enumerate symlinks escaping the bound root',async()=>{
    const {value}=runtime()
    expect((await value.listFiles('/project',undefined,'/project')).map(entry=>entry.name)).toEqual(['safe.ts'])
    await expect(value.listFiles('/project/escape',undefined,'/project')).rejects.toThrow('不属于')
  })
  it('rejects an unbounded or malformed remote request',()=>{
    const input={action:'read',serverId:'00000000-0000-4000-8000-000000000000',path:'/project/a.ts',root:'/project',maxBytes:512*1024}
    expect(remoteFileRequestSchema.safeParse(input).success).toBe(true)
    expect(remoteFileRequestSchema.safeParse({...input,maxBytes:1024*1024}).success).toBe(false)
  })
})
