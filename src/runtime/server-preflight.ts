interface NativeServerBroker {
  status(id: string): Promise<{ trusted: boolean; credential: 'none' | 'password' | 'key' }>
  probe(id: string): Promise<{ home: string }>
  credentials(id: string): Promise<void>
}

/** The normal Renderer receives only status and fixed probes; secrets stay in Electron main. */
export async function readyServerHome(serverId: string): Promise<string> {
  const broker = (globalThis as { __LING_SERVER_BROKER__?: NativeServerBroker }).__LING_SERVER_BROKER__
  if (!broker) throw new Error('远端服务器需要桌面应用。')
  let status = await broker.status(serverId)
  if (!status.trusted || status.credential === 'none') {
    await broker.credentials(serverId)
    status = await broker.status(serverId)
  }
  if (!status.trusted || status.credential === 'none') throw new Error('请先确认服务器指纹并保存登录凭证。')
  try { return (await broker.probe(serverId)).home }
  catch {
    await broker.credentials(serverId)
    return (await broker.probe(serverId)).home
  }
}
