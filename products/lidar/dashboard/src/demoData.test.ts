import { describe, expect, it } from 'vitest'
import { DEMO_COMPARISONS, DEMO_RUNS } from './demoData'

describe('demoData', () => {
  it('provides exactly 3 demo runs with distinct run_ids', () => {
    expect(DEMO_RUNS).toHaveLength(3)
    const ids = DEMO_RUNS.map((run) => run.run_id)
    expect(new Set(ids).size).toBe(3)
  })

  it('marks every run as demo-fixture provenance, never a real source path', () => {
    for (const run of DEMO_RUNS) {
      expect(run.source_path.startsWith('demo/')).toBe(true)
      expect(run.provenance.source).toBe('demo-fixture')
      expect(run.notes).toContain('demostración')
    }
  })

  it('covers three distinct statuses to exercise different dashboard states', () => {
    const statuses = DEMO_RUNS.map((run) => run.status)
    expect(statuses).toEqual(['completed', 'completed', 'failed'])
    expect(DEMO_RUNS[1].readiness?.stage).toBe('physical_face_area')
  })

  it('has a comparison record only for the fully-validated run', () => {
    expect(DEMO_COMPARISONS['demo-run-001']).toHaveLength(1)
    expect(DEMO_COMPARISONS['demo-run-002'] ?? []).toHaveLength(0)
    expect(DEMO_COMPARISONS['demo-run-003'] ?? []).toHaveLength(0)
  })
})
