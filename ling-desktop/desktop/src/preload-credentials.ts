import { contextBridge, ipcRenderer } from 'electron'

// Keep this sandboxed preload self-contained: Electron cannot require tsdown
// shared chunks from a sandboxed preload script.
const IPC = {
  credentialInfo: 'ling:credential-info', credentialInspect: 'ling:credential-inspect',
  credentialTrust: 'ling:credential-trust', credentialPassword: 'ling:credential-password',
  credentialChooseKey: 'ling:credential-choose-key', credentialSaveKey: 'ling:credential-save-key',
  credentialClear: 'ling:credential-clear', credentialTest: 'ling:credential-test',
  credentialClose: 'ling:credential-close',
  credentialResize: 'ling:credential-resize',
} as const

contextBridge.exposeInMainWorld('lingCredentials', {
  info: () => ipcRenderer.invoke(IPC.credentialInfo),
  inspect: () => ipcRenderer.invoke(IPC.credentialInspect),
  trust: (fingerprint: { algorithm: string; sha256: string }) => ipcRenderer.invoke(IPC.credentialTrust, fingerprint),
  password: (password: string) => ipcRenderer.invoke(IPC.credentialPassword, password),
  chooseKey: () => ipcRenderer.invoke(IPC.credentialChooseKey),
  saveKey: (passphrase: string) => ipcRenderer.invoke(IPC.credentialSaveKey, passphrase),
  clear: () => ipcRenderer.invoke(IPC.credentialClear),
  test: () => ipcRenderer.invoke(IPC.credentialTest),
  close: () => ipcRenderer.invoke(IPC.credentialClose),
  resize: (height: number) => ipcRenderer.invoke(IPC.credentialResize, height),
})
