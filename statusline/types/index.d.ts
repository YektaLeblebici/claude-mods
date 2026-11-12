export type Figures = {
  model: string
  ctx?: number
  five?: number
  week?: number
  fiveResetsAt?: string
  weekResetsAt?: string
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    statusline: { figures: Figures | null; effort: string | null }
  }
}
