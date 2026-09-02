import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('api.ts demo mode', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.stubEnv('VITE_CAMPO_DEMO', 'true')
    global.fetch = vi.fn(() => {
      throw new Error('demo mode must never call fetch')
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    global.fetch = originalFetch
  })

  it('listRuns() resolves the 3 bundled demo runs without fetching', async () => {
    const { listRuns } = await import('./api')
    const runs = await listRuns()
    expect(runs).toHaveLength(3)
  })

  it('getRun() resolves a single bundled run by id without fetching', async () => {
    const { getRun } = await import('./api')
    const run = await getRun('demo-run-001')
    expect(run.run_id).toBe('demo-run-001')
  })

  it('getRun() rejects for an unknown id without fetching', async () => {
    const { getRun } = await import('./api')
    await expect(getRun('does-not-exist')).rejects.toThrow()
  })

  it('listComparisons() resolves [] for a run with no bundled comparison', async () => {
    const { listComparisons } = await import('./api')
    expect(await listComparisons('demo-run-003')).toEqual([])
  })
})
