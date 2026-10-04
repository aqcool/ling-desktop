import { posix } from 'node:path'
import type { KnowledgeResponse, KnowledgeSource } from 'ling-desktop/runtime'
import type { KnowledgeScope } from './engine.ts'
import { readCode, sha256 } from './code-index.ts'

/** Structural adapter to DSH's closed read-only LSP seam; no protocol proxy or server installer. */
export interface KnowledgeLsp {
  query(request: { operation: 'goToDefinition' | 'findReferences' | 'goToImplementation'; filePath: string; position: {line:number;character:number}; workspaceRoot: string },signal?:AbortSignal): Promise<{kind:'locations';locations:readonly {uri:string;range:{start:{line:number;character:number};end:{line:number;character:number}}}[];resolvedWorkspaceUri:string}|{kind:'hover';hover:unknown}>
}
export async function navigateCode(lsp: KnowledgeLsp | undefined, scope: KnowledgeScope, source: KnowledgeSource, operation: 'goToDefinition' | 'findReferences' | 'goToImplementation', signal?: AbortSignal): Promise<KnowledgeResponse> {
  if (!lsp) throw new Error('当前没有可用的语言服务器，请在 DSH Profile 中配置 LSP 提供方。')
  // The default DSH LSP service belongs to the local execution world. Remote service routing
  // requires a remote-scoped provider; never send remote paths to a local language server.
  if (scope.remote) throw new Error('此 SSH 项目尚未配置远端语言服务器，可继续使用代码索引查找。')
  if (!scope.root || source.kind !== 'code' || !source.path) throw new Error('请选择代码来源。')
  const cancel = AbortSignal.any([signal ?? new AbortController().signal,AbortSignal.timeout(15000)])
  const body=await readCode(scope.root,source.path,cancel)
  if (source.hash && sha256(body)!==source.hash) throw new Error('代码来源已变化，请刷新来源后再查找。')
  const result=await lsp.query({operation,filePath:source.path,workspaceRoot:scope.root,position:{line:(source.line??1)-1,character:(source.column??1)-1}},cancel)
  if(result.kind!=='locations')throw new Error('语言服务器返回了错误的导航结果。')
  const root=new URL(result.resolvedWorkspaceUri)
  if(root.protocol!=='file:')throw new Error('语言服务器未返回可验证的工作区。')
  const rootPath=decodeURIComponent(root.pathname), hits: NonNullable<KnowledgeResponse['hits']>=[]
  for(const location of result.locations.slice(0,100)){
    cancel.throwIfAborted()
    const uri=new URL(location.uri)
    if(uri.protocol!=='file:'||uri.host!==root.host)continue
    const relative=posix.relative(rootPath,decodeURIComponent(uri.pathname))
    if(!relative||relative==='..'||relative.startsWith('../'))continue
    // Re-authorize against our registered workspace rather than trusting the provider's URI.
    let text:string
    try{text=await readCode(scope.root,relative,cancel)}catch{cancel.throwIfAborted();continue}
    const line=location.range.start.line+1
    if(!Number.isSafeInteger(line)||line<1)continue
    hits.push({id:`code:${relative}`,kind:'code',title:`${relative}:${line}`,snippet:text.split('\n').slice(line-1,line+2).join('\n').slice(0,320),source:{kind:'code',label:`${relative}:${line}`,path:relative,line,column:location.range.start.character+1,endLine:location.range.end.line+1,hash:sha256(text)}})
  }
  return {hits}
}
