import '@testing-library/jest-dom/vitest'

// jsdom (the test DOM environment) does not implement ResizeObserver, but
// MapView.tsx (Leaflet) uses it to keep the map sized to its container.
// Stub it so component/integration tests can mount MapView without a real
// browser; the map's actual resize behavior is not under test here.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// jsdom does not implement canvas 2D rendering (HTMLCanvasElement.getContext
// logs "Not implemented" and returns null). MapView.tsx configures Leaflet
// with `preferCanvas: true`, so every polygon/marker draw call would throw
// on a null context. Stub getContext with a permissive proxy: reads of an
// unset property assume it's a drawing method and return a no-op function;
// reads of a previously-assigned property (e.g. `ctx.lineWidth = 2`) return
// the assigned value. This is enough for Leaflet's canvas renderer to run
// without crashing — actual pixel output is not under test here.
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => {}
  const fakeContext = new Proxy(
    {},
    {
      get: (target, prop) => {
        if (prop in target) {
          return (target as Record<string | symbol, unknown>)[prop]
        }
        return noop
      },
    },
  )

  HTMLCanvasElement.prototype.getContext = (() =>
    fakeContext) as unknown as typeof HTMLCanvasElement.prototype.getContext
}

// jsdom's requestAnimationFrame runs on a real timer, so a Leaflet canvas
// redraw scheduled during mount can fire after a test has already unmounted
// the map (React Testing Library's automatic per-test cleanup), touching a
// renderer whose internal state Leaflet already tore down. No test here
// asserts on animated/deferred map drawing, so it is safe to never invoke
// the callback — this mirrors the ResizeObserver stub above.
globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame
globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
