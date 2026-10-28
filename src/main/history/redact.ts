import { MASK, validatePattern } from '../../shared/redaction'

export { DEFAULT_REDACTION_PATTERNS, MASK, validatePattern } from '../../shared/redaction'

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/i

/**
 * Masks secrets before text is written to disk. Invalid patterns are skipped (use
 * `validatePattern` to tell the user). Line-by-line use is stateful so that the body of a PEM
 * private key spanning many lines is masked as well.
 */
export class Redactor {
  private res: RegExp[]
  private inKey = false

  constructor(patterns: readonly string[]) {
    this.res = []
    for (const p of patterns) {
      if (!p.trim() || validatePattern(p)) continue
      this.res.push(new RegExp(p, 'gid'))
    }
  }

  private mask(s: string): string {
    for (const re of this.res) {
      let out = ''
      let last = 0
      for (const m of s.matchAll(re)) {
        const span = m.indices?.[1] ?? m.indices?.[0]
        if (!span) continue
        out += s.slice(last, span[0]) + MASK
        last = span[1]
      }
      s = out + s.slice(last)
    }
    return s
  }

  /** Redact one line of a continuous stream (tracks multi-line private keys). */
  line(text: string): string {
    if (this.inKey) {
      if (PRIVATE_KEY_END.test(text)) {
        this.inKey = false
        return text
      }
      return MASK
    }
    if (PRIVATE_KEY_BEGIN.test(text) && !PRIVATE_KEY_END.test(text)) {
      this.inKey = true
      return this.mask(text)
    }
    return this.mask(text)
  }

  /** Redact an independent piece of text (a command line); does not touch stream state. */
  text(text: string): string {
    const saved = this.inKey
    this.inKey = false
    const out = text
      .split('\n')
      .map((l) => this.line(l))
      .join('\n')
    this.inKey = saved
    return out
  }
}
