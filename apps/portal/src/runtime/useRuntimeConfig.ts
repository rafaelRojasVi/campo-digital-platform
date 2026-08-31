import { useEffect, useState } from 'react'
import type { CampoRuntimeConfig } from './runtimeConfig'
import { fetchRuntimeConfig } from './runtimeConfig'

const EMPTY_CONFIG: CampoRuntimeConfig = { modules: {} }

export interface RuntimeConfigState {
  config: CampoRuntimeConfig
  loading: boolean
}

export function useRuntimeConfig(): RuntimeConfigState {
  const [state, setState] = useState<RuntimeConfigState>({
    config: EMPTY_CONFIG,
    loading: true,
  })

  useEffect(() => {
    const controller = new AbortController()

    fetchRuntimeConfig(controller.signal).then((config) => {
      if (!controller.signal.aborted) {
        setState({ config, loading: false })
      }
    })

    return () => controller.abort()
  }, [])

  return state
}
