import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFeatureCollection, resetCollectionCacheForTests } from './api.ts'

const fetchMock = vi.fn<typeof fetch>()
const collection = (id: number) =>
  new Response(JSON.stringify({ type: 'FeatureCollection', features: [], id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  resetCollectionCacheForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('feature collection memory cache', () => {
  it('downloads a version once per page session', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(collection(1)))
    const first = await fetchFeatureCollection(1)
    const again = await fetchFeatureCollection(1)
    expect(again).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed download so the next try goes to the network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await expect(fetchFeatureCollection(1)).rejects.toThrow()
    fetchMock.mockImplementation(() => Promise.resolve(collection(1)))
    await fetchFeatureCollection(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps only the two most recent versions', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(collection(Number(String(input).match(/snapshots\/(\d+)/)![1]))),
    )
    await fetchFeatureCollection(1)
    await fetchFeatureCollection(2)
    await fetchFeatureCollection(3)
    await fetchFeatureCollection(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
