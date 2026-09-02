// products/forestry/dashboard/src/api.ts
//
// Demo-only data layer: no live backend exists for this app (unlike LiDAR,
// there is no RBAC'd real Forestry API being guarded against — this app IS
// the demo). Every function below resolves the bundled synthetic fixture
// from ./demoData. See docs/adr/ADR-008-hosted-demo-data-v1.md.
import {
  DEMO_COLLECTION,
  DEMO_COMPARISON,
  DEMO_SNAPSHOT,
  DEMO_SUMMARY,
  demoFeatureDetail,
} from './demoData'
import type {
  FeatureCollection,
  ForestrySnapshot,
  SnapshotSummary,
  SourceFeatureDetail,
  SourceFieldComparison,
} from './types'

export class NoSnapshotError extends Error {
  constructor() {
    super('no forestry snapshot is persisted')
    this.name = 'NoSnapshotError'
  }
}

export function fetchLatestIngestedSnapshot(): Promise<ForestrySnapshot> {
  return Promise.resolve(DEMO_SNAPSHOT)
}

export function fetchSnapshotSummary(snapshotId: number): Promise<SnapshotSummary> {
  if (snapshotId !== DEMO_SNAPSHOT.shapefile_snapshot_id) {
    return Promise.reject(new NoSnapshotError())
  }
  return Promise.resolve(DEMO_SUMMARY)
}

export function fetchFeatureCollection(snapshotId: number): Promise<FeatureCollection> {
  if (snapshotId !== DEMO_SNAPSHOT.shapefile_snapshot_id) {
    return Promise.reject(new NoSnapshotError())
  }
  return Promise.resolve(DEMO_COLLECTION)
}

export function fetchComparison(snapshotId: number): Promise<SourceFieldComparison> {
  if (snapshotId !== DEMO_SNAPSHOT.shapefile_snapshot_id) {
    return Promise.reject(new NoSnapshotError())
  }
  return Promise.resolve(DEMO_COMPARISON)
}

export function fetchFeatureDetail(
  snapshotId: number,
  featureOrdinal: number,
): Promise<SourceFeatureDetail> {
  if (snapshotId !== DEMO_SNAPSHOT.shapefile_snapshot_id) {
    return Promise.reject(new NoSnapshotError())
  }
  const detail = demoFeatureDetail(featureOrdinal)
  if (!detail) {
    return Promise.reject(new Error(`unknown demo feature ordinal: ${featureOrdinal}`))
  }
  return Promise.resolve(detail)
}
