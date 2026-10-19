import { reportPath } from '../router.ts'

// The polygons «Copiar» puts aside, kept per browser tab so the map and the
// report editor share them. Ordinals belong to one base version.

const CLIPBOARD_KEY = 'rodales.informes.portapapeles'

/** `?pegar=1` on the editor: paste the clipboard once on arrival. */
export const PASTE_PARAM = 'pegar'

export interface Clipboard {
  base_snapshot_id: number
  ordinals: number[]
}

export function readClipboard(): Clipboard | null {
  try {
    const raw = window.sessionStorage.getItem(CLIPBOARD_KEY)
    return raw === null ? null : (JSON.parse(raw) as Clipboard)
  } catch {
    return null
  }
}

export function writeClipboard(clipboard: Clipboard): void {
  try {
    window.sessionStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboard))
  } catch {
    // Storage blocked: copy/paste still works inside the editor page.
  }
}

/** The editor link that pastes the clipboard on arrival. */
export function pastePath(reportId: number): string {
  return `${reportPath(reportId)}&${PASTE_PARAM}=1`
}
