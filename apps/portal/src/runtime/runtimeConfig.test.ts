import { describe, expect, it } from 'vitest'
import { moduleStatusFor, parseRuntimeConfig } from './runtimeConfig'

describe('parseRuntimeConfig', () => {
  it('parses a well-formed config', () => {
    const config = parseRuntimeConfig({
      generatedAt: '2026-08-31T12:00:00Z',
      portal: { port: 5100 },
      modules: {
        lidar: { status: 'available', url: 'http://127.0.0.1:5174/', owned: true },
        forestal: { status: 'unavailable' },
      },
    })

    expect(config.generatedAt).toBe('2026-08-31T12:00:00Z')
    expect(config.portal?.port).toBe(5100)
    expect(config.modules.lidar).toEqual({
      status: 'available',
      url: 'http://127.0.0.1:5174/',
      owned: true,
    })
    expect(config.modules.forestal).toEqual({ status: 'unavailable' })
    expect(config.modules.transelec).toBeUndefined()
  })

  it('never throws on malformed input and degrades to empty', () => {
    expect(parseRuntimeConfig(null).modules).toEqual({})
    expect(parseRuntimeConfig(undefined).modules).toEqual({})
    expect(parseRuntimeConfig('not an object').modules).toEqual({})
    expect(parseRuntimeConfig(42).modules).toEqual({})
    expect(parseRuntimeConfig({ modules: 'nope' }).modules).toEqual({})
  })

  it('drops modules with an invalid status rather than trusting them', () => {
    const config = parseRuntimeConfig({
      modules: {
        lidar: { status: 'running-ish', url: 'http://127.0.0.1:9999/' },
      },
    })

    expect(config.modules.lidar).toBeUndefined()
  })

  it('ignores unknown module keys', () => {
    const config = parseRuntimeConfig({
      modules: { unknownProduct: { status: 'available' } },
    })

    expect(config.modules).toEqual({})
  })
})

describe('moduleStatusFor', () => {
  it('defaults to unavailable when a module is missing from the config', () => {
    const status = moduleStatusFor({ modules: {} }, 'lidar')
    expect(status).toEqual({ status: 'unavailable' })
  })
})

describe('parseRuntimeConfig measurementCount', () => {
  it('parses a numeric measurementCount for a module', () => {
    const config = parseRuntimeConfig({
      modules: {
        lidar: { status: 'available', url: 'http://127.0.0.1:5174/', measurementCount: 14 },
      },
    })

    expect(config.modules.lidar?.measurementCount).toBe(14)
  })

  it('is undefined when the module carries no measurementCount', () => {
    const config = parseRuntimeConfig({
      modules: { forestal: { status: 'available' } },
    })

    expect(config.modules.forestal?.measurementCount).toBeUndefined()
  })

  it('drops a non-numeric measurementCount rather than trusting it', () => {
    const config = parseRuntimeConfig({
      modules: { lidar: { status: 'available', measurementCount: 'fourteen' } },
    })

    expect(config.modules.lidar?.measurementCount).toBeUndefined()
  })
})
