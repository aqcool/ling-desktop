import { Client } from 'ssh2'
import { BrokerSshConnection } from '../../src/ssh/connection.ts'
import { DshRemoteRuntime } from '../../src/ssh/runtime.ts'

const [port, node, helper, hash, workspace] = process.argv.slice(2)
const client = new Client()
await new Promise((resolve, reject) => {
  client.once('ready', resolve).once('error', reject)
  client.connect({ host: '127.0.0.1', port: Number(port), username: 'tester', password: 'test-secret' })
})
const connection = new BrokerSshConnection(client, node, helper, hash, workspace)
let runtime
try {
  runtime = await DshRemoteRuntime.create(connection)
  const terminal = await runtime.terminal(workspace, 80, 24)
  let output = ''
  terminal.output.on('data', data => { output += data.toString() })
  await terminal.resize(100, 30)
  await terminal.write("printf 'LING-%s\\n' ELECTRON-PTY; stty size\r")
  const timeout = Date.now() + 5000
  while ((!output.includes('LING-ELECTRON-PTY') || !output.includes('30 100')) && Date.now() < timeout) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  if (!output.includes('LING-ELECTRON-PTY') || !output.includes('30 100')) throw new Error('Electron PTY did not return command output and dimensions')
  await terminal.terminate()
  process.stdout.write('ELECTRON_PTY_OK\n')
} finally { if (runtime) await runtime.close(); else await connection.dispose() }
