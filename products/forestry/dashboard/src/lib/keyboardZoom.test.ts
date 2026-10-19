import { describe, expect, it } from 'vitest'
import L from 'leaflet'
import { installKeyboardZoom, keyboardZoomStep } from './keyboardZoom.ts'

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { cancelable: true, ...init })

describe('keyboardZoomStep', () => {
  it.each([
    [{ ctrlKey: true, key: '+' }, 1],
    [{ ctrlKey: true, key: '=' }, 1],
    [{ metaKey: true, key: '+' }, 1],
    [{ ctrlKey: true, code: 'NumpadAdd', key: '+' }, 1],
    [{ ctrlKey: true, key: '-' }, -1],
    [{ ctrlKey: true, key: '_' }, -1],
    [{ ctrlKey: true, code: 'NumpadSubtract', key: '-' }, -1],
  ])('reads %j as %i', (init, step) => {
    expect(keyboardZoomStep(key(init))).toBe(step)
  })

  it.each([{ key: '+' }, { ctrlKey: true, key: '0' }, { ctrlKey: true, altKey: true, key: '+' }])(
    'ignores %j',
    (init) => {
      expect(keyboardZoomStep(key(init))).toBe(0)
    },
  )
})

describe('installKeyboardZoom', () => {
  function setup() {
    const container = document.createElement('div')
    document.body.append(container)
    const calls: string[] = []
    const map = {
      getContainer: () => container,
      zoomIn: () => calls.push('in'),
      zoomOut: () => calls.push('out'),
    } as unknown as L.Map
    const uninstall = installKeyboardZoom(map)
    return { container, calls, uninstall }
  }

  it('zooms the map instead of the page while the pointer is over it', () => {
    const { container, calls, uninstall } = setup()
    container.dispatchEvent(new MouseEvent('pointerenter'))
    const event = key({ ctrlKey: true, key: '+' })
    document.dispatchEvent(event)
    expect(calls).toEqual(['in'])
    expect(event.defaultPrevented).toBe(true)
    uninstall()
  })

  it('leaves the browser zoom alone when the pointer is elsewhere', () => {
    const { container, calls, uninstall } = setup()
    container.dispatchEvent(new MouseEvent('pointerenter'))
    container.dispatchEvent(new MouseEvent('pointerleave'))
    const event = key({ ctrlKey: true, key: '-' })
    document.dispatchEvent(event)
    expect(calls).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    uninstall()
  })
})
