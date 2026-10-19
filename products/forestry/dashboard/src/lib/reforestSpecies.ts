/**
 * Species offered when planning a reforestation, in two groups. Suggested
 * only: any other species can be typed. The plantations are the base's 14
 * prefixes (lib/species.ts) by their usual names; the natives are those Campo
 * Digital replants after harvest.
 */
export const MAX_REFOREST_SPECIES = 6

export const REFOREST_GROUPS: readonly { label: string; names: readonly string[] }[] = [
  {
    label: 'Plantaciones',
    names: [
      'pino radiata',
      'pino oregón',
      'Eucalyptus nitens',
      'Eucalyptus globulus',
      'Sequoia sempervirens',
      'secuoya',
      'ciprés',
      'aliso',
      'aromo',
    ],
  },
  {
    label: 'Nativas',
    names: ['roble', 'raulí', 'coigüe', 'ulmo', 'tepa', 'canelo', 'arrayán', 'luma', 'mañío', 'lingue', 'laurel'],
  },
]

/** Case- and accent-insensitive form, to match «coigue» with «coigüe». */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('es')
    .trim()
}
