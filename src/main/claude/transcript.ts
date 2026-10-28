/** Window assumed when nothing says otherwise; sessions past it must be on the 1M-token window. */
export const STANDARD_WINDOW = 200_000
export const LARGE_WINDOW = 1_000_000

export interface TranscriptUsage {
  /** Tokens the last request sent to the model, i.e. what currently fills the context. */
  tokens: number
  model: string | null
}

interface UsageLine {
  isSidechain?: boolean
  message?: {
    model?: string
    usage?: {
      input_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

/**
 * The context size according to the newest model response in a Claude Code transcript (JSONL).
 * Sub-agent turns run in their own context, so they are skipped. A cut-off first line (when only
 * the tail of a big file was read) fails to parse and is ignored like any other bad line.
 */
export function lastContextTokens(jsonl: string): TranscriptUsage | null {
  const lines = jsonl.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes('"usage"')) continue
    let o: UsageLine
    try {
      o = JSON.parse(line) as UsageLine
    } catch {
      continue
    }
    const u = o.message?.usage
    if (!u || o.isSidechain || o.message?.model === '<synthetic>') continue
    const tokens =
      (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0)
    if (tokens > 0) return { tokens, model: o.message?.model ?? null }
  }
  return null
}

/** Share of the context window in use, 0 - 100. A session past `window` is on the 1M window. */
export function contextPercent(
  tokens: number,
  window: number
): { percent: number; window: number } {
  const w = tokens > window ? Math.max(window, LARGE_WINDOW) : window
  return { percent: Math.min(100, Math.round((tokens / w) * 100)), window: w }
}
