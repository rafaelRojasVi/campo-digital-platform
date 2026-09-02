import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedModuleUrls } from './hostedModules'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('hostedModuleUrls', () => {
  it('includes lidar only when VITE_LIDAR_HOSTED_URL is set', () => {
    expect(hostedModuleUrls()).toEqual({})

    vi.stubEnv('VITE_LIDAR_HOSTED_URL', 'https://campo-digital-lidar-staging.onrender.com')
    expect(hostedModuleUrls()).toEqual({
      lidar: 'https://campo-digital-lidar-staging.onrender.com',
    })
  })

  it('includes forestal only when VITE_FORESTAL_HOSTED_URL is set', () => {
    expect(hostedModuleUrls().forestal).toBeUndefined()

    vi.stubEnv('VITE_FORESTAL_HOSTED_URL', 'https://campo-digital-forestal-staging.onrender.com')
    expect(hostedModuleUrls()).toEqual({
      forestal: 'https://campo-digital-forestal-staging.onrender.com',
    })
  })

  it('includes transelec only when VITE_TRANSELEC_HOSTED_URL is set', () => {
    expect(hostedModuleUrls().transelec).toBeUndefined()

    vi.stubEnv(
      'VITE_TRANSELEC_HOSTED_URL',
      'https://campo-digital-transelec-staging.onrender.com',
    )
    expect(hostedModuleUrls()).toEqual({
      transelec: 'https://campo-digital-transelec-staging.onrender.com',
    })
  })

  it('leaves forestal and transelec absent, not empty, when their env vars are unset', () => {
    vi.stubEnv('VITE_LIDAR_HOSTED_URL', 'https://campo-digital-lidar-staging.onrender.com')
    const urls = hostedModuleUrls()
    expect(urls.forestal).toBeUndefined()
    expect(urls.transelec).toBeUndefined()
    expect('forestal' in urls).toBe(false)
    expect('transelec' in urls).toBe(false)
  })
})
