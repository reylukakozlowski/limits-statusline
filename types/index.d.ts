// The $.state contract of the limits-statusline mod (checked by `claude plugin validate`).

export type LimitsTracker = {
  effort: string | null
  cache: { input: number; creation: number; read: number }
  history: number[]
  git: { isRepo: boolean; branch: string | null; isDirty: boolean } | null
}

declare module 'claude-code' {
  interface PluginState {
    'limits-statusline': { tracker: LimitsTracker }
  }
}
