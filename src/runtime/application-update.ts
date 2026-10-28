export type LingUpdateChannel = 'stable' | 'preview'
export type LingUpdatePhase = 'unavailable' | 'idle' | 'checking' | 'downloading' | 'downloaded' | 'installing' | 'error'

export interface LingUpdateState {
  readonly currentVersion: string
  readonly channel: LingUpdateChannel
  readonly phase: LingUpdatePhase
  readonly version?: string
  readonly releaseNotes?: string
  readonly progress?: { readonly percent: number; readonly transferred: number; readonly total: number; readonly bytesPerSecond: number }
  readonly lastCheckedAt?: number
  readonly message?: string
}

export interface LingUpdateBridge {
  get(): Promise<LingUpdateState>
  check(): Promise<LingUpdateState>
  setChannel(channel: LingUpdateChannel): Promise<LingUpdateState>
  install(): Promise<LingUpdateState>
  subscribe(callback: (state: LingUpdateState) => void): () => void
  beforeInstall?(callback: () => string | undefined): () => void
}

declare global {
  interface Window { __LING_UPDATE__?: LingUpdateBridge }
}
