export type Prompt = { id: string; text: string; isCommand?: true }

declare module 'claude-code' {
  interface PluginState {
    mymsg: {
      prompts: Prompt[]
      // Index into the rows shown (the filtered list).
      cursor: number
      // Stored row id -> its place in the session's transcript.
      order: Record<string, number>
      // Output rows of commands the person did not run (Claude, a plugin, a peer).
      others: Record<string, true>
      // The search text; rows not containing it are hidden.
      query: string
      // The field open below the rows, if any.
      field: '' | 'find' | 'number'
    }
  }
}
