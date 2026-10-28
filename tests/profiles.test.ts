import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\tmp' } }))

import { parseWslList } from '../src/main/profiles'

describe('parseWslList', () => {
  it('decodes UTF-16LE output, drops blanks and docker distros', () => {
    const text = '\uFEFFUbuntu\r\ndocker-desktop\r\nDebian\r\n\r\n'
    expect(parseWslList(Buffer.from(text, 'utf16le'))).toEqual(['Ubuntu', 'Debian'])
  })

  it('returns an empty list for empty output', () => {
    expect(parseWslList(Buffer.alloc(0))).toEqual([])
  })
})
