import type { ModuleId } from './runtimeConfig'

/**
 * The closed set of STAGING module URLs this build knows about, baked in at
 * build time via render.yaml envVars. Forestry and Transelec now also point
 * at demo-only static sites (see Task 19) rather than the real backend —
 * the "closed set, baked in at build time" property is unchanged: a key
 * only ever appears here alongside a real deployed static site.
 */
export function hostedModuleUrls(): Partial<Record<ModuleId, string>> {
  const urls: Partial<Record<ModuleId, string>> = {}

  const lidarUrl = import.meta.env.VITE_LIDAR_HOSTED_URL
  if (lidarUrl) {
    urls.lidar = lidarUrl
  }

  const forestalUrl = import.meta.env.VITE_FORESTAL_HOSTED_URL
  if (forestalUrl) {
    urls.forestal = forestalUrl
  }

  const transelecUrl = import.meta.env.VITE_TRANSELEC_HOSTED_URL
  if (transelecUrl) {
    urls.transelec = transelecUrl
  }

  return urls
}
