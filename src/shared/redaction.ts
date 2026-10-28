export const MASK = '[REDACTED]'

/**
 * Defaults, as regular-expression source (matched case-insensitively). When a pattern has a
 * capture group only group 1 is masked, so the key name stays readable (`password=[REDACTED]`).
 */
export const DEFAULT_REDACTION_PATTERNS: string[] = [
  // password=..., api_key: ..., AWS_SECRET_ACCESS_KEY=..., "token": "..."
  String.raw`[\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*["']?\s*[=:]\s*["']?([^\s"',;]+)`,
  // --password hunter2, --token=abc, --api-key abc
  String.raw`--(?:password|passwd|token|secret|api-key|apikey|access-key)(?:=|\s+)([^\s]+)`,
  // HTTP auth headers and bare bearer tokens
  String.raw`authorization:\s*(?:bearer|basic|token)\s+([A-Za-z0-9._~+/=-]+)`,
  String.raw`\bbearer\s+([A-Za-z0-9._~+/=-]{16,})`,
  // credentials embedded in URLs: https://user:secret@host
  String.raw`://[^/\s:@]+:([^@\s/]+)@`,
  // GitHub, GitLab, Slack, AWS, Stripe-style tokens and JWTs
  String.raw`\b(gh[pousr]_[A-Za-z0-9]{30,})\b`,
  String.raw`\b(github_pat_[A-Za-z0-9_]{20,})\b`,
  String.raw`\b(glpat-[A-Za-z0-9_-]{16,})\b`,
  String.raw`\b(xox[abprs]-[A-Za-z0-9-]{10,})\b`,
  String.raw`\b(AKIA[0-9A-Z]{16})\b`,
  String.raw`\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b`,
  String.raw`\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b`
]

/** Returns an error message when `pattern` is not a valid regular expression. */
export function validatePattern(pattern: string): string | null {
  try {
    new RegExp(pattern, 'gid')
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
