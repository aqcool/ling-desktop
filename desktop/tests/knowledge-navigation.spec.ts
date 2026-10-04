import { mkdtemp,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe,expect,it,vi } from 'vitest'
import { navigateCode, type KnowledgeLsp } from '../src/knowledge/navigation.ts'
import { sha256 } from '../src/knowledge/code-index.ts'
describe('DSH semantic navigation adapter',()=>{
  it('converts UTF-16 coordinates, discards outside locations and cites freshly authorized code',async()=>{
    const root=await mkdtemp(join(tmpdir(),'ling-lsp-'))
    try{
      const body='export function hello() {}\nhello()';await writeFile(join(root,'a.ts'),body)
      const query=vi.fn(async()=>({kind:'locations' as const,resolvedWorkspaceUri:pathToFileURL(root).href,locations:[
        {uri:pathToFileURL(join(root,'a.ts')).href,range:{start:{line:0,character:16},end:{line:0,character:21}}},
        {uri:pathToFileURL(join(root,'..','secret.ts')).href,range:{start:{line:0,character:0},end:{line:0,character:1}}},
      ]}))
      const result=await navigateCode({query},{id:'project',workspaceId:'project',root,label:'project'},{kind:'code',label:'a.ts',path:'a.ts',line:2,column:1,hash:sha256(body)},'goToDefinition')
      expect(query).toHaveBeenCalledWith({operation:'goToDefinition',filePath:'a.ts',workspaceRoot:root,position:{line:1,character:0}},expect.any(AbortSignal))
      expect(result.hits).toHaveLength(1)
      expect(result.hits?.[0]?.source).toMatchObject({path:'a.ts',line:1,column:17,hash:sha256(body)})
      await expect(navigateCode({query},{id:'project',workspaceId:'project',root,label:'project'},{kind:'code',label:'a.ts',path:'a.ts',hash:'outdated'},'findReferences')).rejects.toThrow('已变化')
    }finally{await rm(root,{recursive:true,force:true})}
  })
  it('never dispatches a remote source to a local language server',async()=>{
    const query=vi.fn() as unknown as KnowledgeLsp['query']
    await expect(navigateCode({query},{id:'ssh',workspaceId:null,root:'/project',label:'remote',remote:{serverId:'server',taskId:'task'}},{kind:'code',label:'a.ts',path:'a.ts'},'findReferences')).rejects.toThrow('远端语言服务器')
    expect(query).not.toHaveBeenCalled()
  })
})
