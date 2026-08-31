import { describe, expect, it } from 'vitest'
import { isSafeLocalUrl } from './safeUrl'

describe('isSafeLocalUrl', () => {
  it('accepts http URLs on loopback hosts', () => {
    expect(isSafeLocalUrl('http://127.0.0.1:5173/')).toBe(true)
    expect(isSafeLocalUrl('http://localhost:5173/modulo')).toBe(true)
  })

  it('rejects missing or empty values', () => {
    expect(isSafeLocalUrl(undefined)).toBe(false)
    expect(isSafeLocalUrl(null)).toBe(false)
    expect(isSafeLocalUrl('')).toBe(false)
  })

  it('rejects non-loopback hosts', () => {
    expect(isSafeLocalUrl('http://evil.example.com/')).toBe(false)
    expect(isSafeLocalUrl('http://10.0.0.5:8000/')).toBe(false)
  })

  it('rejects unsafe schemes', () => {
    expect(isSafeLocalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeLocalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeLocalUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isSafeLocalUrl('not a url')).toBe(false)
  })
})
