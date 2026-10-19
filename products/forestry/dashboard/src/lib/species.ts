// Planted species read from the 2026 use code (CodUso_2026). This is an
// INFERENCE, not a source field: the code's two-letter prefixes name the
// species and the digits the plantation year (Pi06 = P. radiata 2006).
// Prefix names are confirmed by the base's own DescUso values, except Co, Ra,
// Ul and Te (only "Plantacion de nativas") and Al, Se, Ci, Ss (unknown; see
// products/forestry/docs/dashboard-v1.md, "Species").
//
// Only the first word of the code is read: later words describe what grows
// under or around the stand (Pi Rn = pine regeneration, Rzg = rezagado).

const CONFIRMED: Readonly<Record<string, string>> = {
  Pi: 'pino radiata',
  Po: 'pino oregón',
  En: 'Eucalyptus nitens',
  Eg: 'Eucalyptus globulus',
  Ar: 'aromo',
  Ro: 'roble',
  Co: 'coigüe',
  Ra: 'raulí',
  Ul: 'ulmo',
  Te: 'tepa',
}

const UNCONFIRMED: ReadonlySet<string> = new Set(['Al', 'Se', 'Ci', 'Ss'])

// A mixture is the same whichever species the code names first (CoRa03 and
// RaCo07 are both coigüe + raulí), so groups list species in this order.
const SPECIES_ORDER: readonly string[] = [...Object.keys(CONFIRMED), ...UNCONFIRMED]

export interface SpeciesGroup {
  /** Stable key: species prefixes joined by "+" in SPECIES_ORDER. */
  key: string
  label: string
  /** False when any prefix still waits for Campo Digital's confirmation. */
  confirmed: boolean
}

export const ENSAYO_GROUP: SpeciesGroup = {
  key: '__ensayo__',
  label: 'Ensayo (varias especies)',
  confirmed: true,
}

export const NO_SPECIES_GROUP: SpeciesGroup = {
  key: '__sin_especie__',
  label: 'Sin especie en el código',
  confirmed: true,
}

const isSpecies = (token: string) => token in CONFIRMED || UNCONFIRMED.has(token)

/** Species prefixes of the code's first word, in order, without repeats. */
export function speciesTokens(code: string | null): string[] {
  const word = (code ?? '').trim().split(/\s+/)[0] ?? ''
  // An all-caps prefix may precede the species (CPLCo06).
  let rest = word.replace(/^[A-Z]{2,}(?=[A-Z][a-z])/, '')
  const tokens: string[] = []

  while (rest !== '') {
    const token = rest.slice(0, 2)
    if (!/^[A-Z][a-z]$/.test(token) || !isSpecies(token)) break
    rest = rest.slice(2)
    // A species name must end at a year, another species, or the word's end
    // ("Ali" is not "Al" + "i").
    if (/^[a-z]/.test(rest)) return []
    if (!tokens.includes(token)) tokens.push(token)
    rest = rest.replace(/^(\d\d|\?\?)+/, '')
  }

  return tokens
}

function speciesName(token: string): string {
  return CONFIRMED[token] ?? `${token} (por confirmar)`
}

/** The species group a polygon's 2026 use code belongs to. */
export function speciesGroup(code: string | null): SpeciesGroup {
  if (code !== null && /^ES(\d|\s|$)/.test(code.trim())) return ENSAYO_GROUP
  return groupFromTokens(speciesTokens(code))
}

/** The legend/filter label of a species group key (e.g. 'Po+Ra'). */
export function speciesLabel(key: string): string {
  if (key === ENSAYO_GROUP.key) return ENSAYO_GROUP.label
  if (key === NO_SPECIES_GROUP.key) return NO_SPECIES_GROUP.label
  return groupFromTokens(key.split('+')).label
}

function groupFromTokens(tokens: string[]): SpeciesGroup {
  if (tokens.length === 0) return NO_SPECIES_GROUP
  tokens = [...tokens].sort((a, b) => SPECIES_ORDER.indexOf(a) - SPECIES_ORDER.indexOf(b))

  const confirmed = tokens.every((token) => token in CONFIRMED)
  if (tokens.length === 1) {
    const [token] = tokens as [string]
    const name = CONFIRMED[token]
    return {
      key: token,
      label: name === undefined ? `${token} (especie por confirmar)` : capitalize(name),
      confirmed,
    }
  }

  return {
    key: tokens.join('+'),
    label: `Mixta: ${tokens.map(speciesName).join(' + ')}`,
    confirmed,
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
