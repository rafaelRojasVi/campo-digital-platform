import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
}

/** Points per pixel of area; capped so a wide screen stays light. */
const DENSITY = 1 / 14000
const MAX_PARTICLES = 64
const LINK_DISTANCE = 130
const LINK_DISTANCE_SQ = LINK_DISTANCE * LINK_DISTANCE
/** The drift is slow; 30 frames a second looks the same and costs half. */
const FRAME_MS = 1000 / 30
/** Lines are batched by strength: one stroke per band instead of one per line. */
const BANDS = 4

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** A device with few cores, or a reader asking to save data, gets fewer points. */
function lightDevice(): boolean {
  const cores = navigator.hardwareConcurrency ?? 8
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return cores <= 4 || connection?.saveData === true
}

/**
 * The drifting point-and-line network behind the front door's greeting: the
 * same idea as the particle background on campodigital.cl, drawn here on one
 * canvas with no library. Decorative only.
 *
 * Kept cheap on purpose: 30 frames a second, lines stroked in four batches,
 * a pixel ratio capped at 1.5, fewer points on light devices, and nothing at
 * all while the canvas is off screen or the tab is hidden. With reduced
 * motion it draws one still frame.
 */
export function ParticleNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    // jsdom (the tests) has neither; there is nothing to draw on there.
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const context = canvas.getContext('2d')
    if (!context) return

    let particles: Particle[] = []
    let width = 0
    let height = 0
    let frame = 0
    let lastStep = 0
    let onScreen = true
    const still = reducedMotion()
    const maxParticles = lightDevice() ? MAX_PARTICLES / 2 : MAX_PARTICLES

    const seed = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const count = Math.min(maxParticles, Math.round(width * height * DENSITY))
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.16 + Math.random() * 0.44,
      }))
    }

    const bands: Path2D[] = []
    const draw = () => {
      context.clearRect(0, 0, width, height)
      for (let band = 0; band < BANDS; band += 1) bands[band] = new Path2D()
      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i]
        for (let j = i + 1; j < particles.length; j += 1) {
          const b = particles[j]
          const dx = a.x - b.x
          if (dx > LINK_DISTANCE || dx < -LINK_DISTANCE) continue
          const dy = a.y - b.y
          const distanceSq = dx * dx + dy * dy
          if (distanceSq >= LINK_DISTANCE_SQ) continue
          const strength = 1 - Math.sqrt(distanceSq) / LINK_DISTANCE
          const band = Math.min(BANDS - 1, Math.floor(strength * BANDS))
          bands[band].moveTo(a.x, a.y)
          bands[band].lineTo(b.x, b.y)
        }
      }
      context.lineWidth = 1
      for (let band = 0; band < BANDS; band += 1) {
        context.strokeStyle = `rgba(255, 255, 255, ${(0.28 * (band + 1)) / BANDS})`
        context.stroke(bands[band])
      }
      const dots = new Path2D()
      for (const particle of particles) {
        dots.moveTo(particle.x + 1.6, particle.y)
        dots.arc(particle.x, particle.y, 1.6, 0, Math.PI * 2)
      }
      context.fillStyle = 'rgba(255, 255, 255, 0.55)'
      context.fill(dots)
    }

    const step = (now: number) => {
      frame = requestAnimationFrame(step)
      if (now - lastStep < FRAME_MS) return
      lastStep = now
      for (const particle of particles) {
        particle.x += particle.vx
        particle.y += particle.vy
        if (particle.y > height + 10) {
          particle.y = -10
          particle.x = Math.random() * width
        }
        if (particle.x < -10) particle.x = width + 10
        if (particle.x > width + 10) particle.x = -10
      }
      draw()
    }

    const start = () => {
      cancelAnimationFrame(frame)
      if (still || document.hidden || !onScreen) draw()
      else frame = requestAnimationFrame(step)
    }

    seed()
    start()

    const resize = new ResizeObserver(() => {
      seed()
      start()
    })
    resize.observe(canvas)
    const visibility =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            onScreen = entry.isIntersecting
            start()
          })
    visibility?.observe(canvas)
    document.addEventListener('visibilitychange', start)

    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      visibility?.disconnect()
      document.removeEventListener('visibilitychange', start)
    }
  }, [])

  return <canvas ref={canvasRef} className="hub__particles" aria-hidden="true" />
}
