import { describe, expect, it } from 'vitest'
import { DEFAULT_REDACTION_PATTERNS, Redactor, validatePattern } from '../src/main/history/redact'

const r = (): Redactor => new Redactor(DEFAULT_REDACTION_PATTERNS)

describe('Redactor defaults', () => {
  it.each([
    ['set PASSWORD=hunter2', 'set PASSWORD=[REDACTED]'],
    [
      'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG',
      'export AWS_SECRET_ACCESS_KEY=[REDACTED]'
    ],
    [
      'curl -H "Authorization: Bearer abc.def-123_456"',
      'curl -H "Authorization: Bearer [REDACTED]"'
    ],
    ['mysql --password hunter2 -h db', 'mysql --password [REDACTED] -h db'],
    ['mysql --password=hunter2 -h db', 'mysql --password=[REDACTED] -h db'],
    [
      'git clone https://bob:s3cr3t@github.com/x/y.git',
      'git clone https://bob:[REDACTED]@github.com/x/y.git'
    ],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789 ok', 'token [REDACTED] ok'],
    ['key AKIAIOSFODNN7EXAMPLE here', 'key [REDACTED] here'],
    ['{"api_key": "sk_live_abcdefghijklmnop1234"}', '{"api_key": "[REDACTED]"}']
  ])('masks %s', (input, expected) => {
    expect(r().line(input)).toBe(expected)
  })

  it('masks a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(r().line(`jwt=${jwt}`)).not.toContain('eyJ')
  })

  it('leaves ordinary text alone', () => {
    for (const s of [
      'git status',
      'On branch main',
      'tokenizer finished in 3s',
      'C:\\dev\\api>dir'
    ]) {
      expect(r().line(s)).toBe(s)
    }
  })

  it('masks the body of a multi-line private key', () => {
    const red = r()
    const out = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ',
      'AAAAB3NzaC1yc2EAAAADAQABAAABAQC',
      '-----END OPENSSH PRIVATE KEY-----',
      'ls'
    ].map((l) => red.line(l))
    expect(out).toEqual([
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      '[REDACTED]',
      '[REDACTED]',
      '-----END OPENSSH PRIVATE KEY-----',
      'ls'
    ])
  })
})

describe('Redactor custom patterns', () => {
  it('masks the whole match when there is no capture group', () => {
    expect(new Redactor(['internal-\\d+']).line('see internal-4711 now')).toBe('see [REDACTED] now')
  })

  it('skips invalid patterns instead of throwing', () => {
    expect(validatePattern('(unclosed')).toBeTruthy()
    expect(validatePattern('ok+')).toBeNull()
    expect(new Redactor(['(unclosed', 'foo']).line('a foo b')).toBe('a [REDACTED] b')
  })

  it('text() does not disturb the stream state used by line()', () => {
    const red = r()
    red.line('-----BEGIN RSA PRIVATE KEY-----')
    expect(red.text('echo hi')).toBe('echo hi')
    expect(red.line('MIIEowIBAAKCAQEA')).toBe('[REDACTED]')
  })
})
