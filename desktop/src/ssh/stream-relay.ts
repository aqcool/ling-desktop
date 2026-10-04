import type { Client, ClientChannel } from 'ssh2'
import type { Socket } from 'node:net'
import type { SshStreamEndpoint } from '@deepseek-ai/dsh-ssh/schemas'

// Electron's BoringSSL lacks the helper's AEAD PSK cipher. Authenticate with the
// already-installed remote Node instead; plaintext remains inside pinned SSH.
// The stream capability travels through SSH stdin, never command arguments.
const relay = String.raw`
const tls = require('node:tls');
let input = '', socket;
const fail = () => { socket?.destroy(); process.exit(1); };
const deadline = setTimeout(fail, 30000);
process.stdin.on('error', fail);
process.stdout.on('error', fail);
process.stdin.on('end', () => { if (!socket) fail(); });
function configure(chunk) {
  input += chunk.toString('utf8');
  if (input.length > 8192) return fail();
  const end = input.indexOf('\n');
  if (end < 0) return;
  process.stdin.off('data', configure);
  process.stdin.pause();
  try {
    const endpoint = JSON.parse(input.slice(0, end));
    if (!/^[a-f0-9]{64}$/.test(endpoint.capability) || end !== input.length - 1) return fail();
    socket = tls.connect({ path: endpoint.path, ciphers: 'PSK-AES256-GCM-SHA384',
      minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', rejectUnauthorized: true,
      pskCallback: () => ({ identity: 'dsh-stream', psk: Buffer.from(endpoint.capability, 'hex') }),
      checkServerIdentity: () => undefined });
    socket.on('error', fail);
    socket.on('close', () => process.exit(0));
    socket.once('secureConnect', () => {
      clearTimeout(deadline);
      socket.disableRenegotiation();
      process.stderr.write('LING_TLS_READY\n');
      process.stdin.pipe(socket).pipe(process.stdout);
    });
  } catch { fail(); }
}
process.stdin.on('data', configure);
`
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

/** Return only after the exact upstream TLS-PSK handshake succeeds. */
export async function relaySshStream(client: Client, node: string, endpoint: SshStreamEndpoint, signal: AbortSignal): Promise<Socket> {
  signal.throwIfAborted()
  const channel = await new Promise<ClientChannel>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    client.exec(`${quote(node)} -e ${quote(relay)}`, (error, stream) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) { stream?.destroy(); reject(signal.reason) }
      else if (error) reject(error)
      else resolve(stream)
    })
    if (signal.aborted) abort()
  })
  const abort = () => channel.destroy()
  signal.addEventListener('abort', abort, { once: true })
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => { cleanup(); reject(signal.aborted ? signal.reason : new Error('远端加密数据通道连接失败。')) }
      const ready = (data: Buffer) => {
        status += data.toString('utf8')
        if (status.length > 1024) fail()
        else if (status === 'LING_TLS_READY\n') { cleanup(); resolve() }
      }
      let status = ''
      const cleanup = () => { channel.stderr.off('data', ready); channel.off('error', fail); channel.off('close', fail); channel.off('exit', fail) }
      channel.stderr.on('data', ready)
      channel.once('error', fail).once('close', fail).once('exit', fail)
      channel.write(JSON.stringify(endpoint) + '\n')
      if (signal.aborted) { abort(); fail() }
    })
    channel.stderr.resume()
    channel.pause()
    return channel as unknown as Socket
  } catch (error) { channel.destroy(); throw error }
  finally { signal.removeEventListener('abort', abort) }
}
