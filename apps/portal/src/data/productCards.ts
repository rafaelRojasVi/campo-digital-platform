import type { ProductKey } from '../lib/platformApi'

export interface ProductCard {
  key: ProductKey
  title: string
  /** One line under the title. */
  description: string
  /** What the project is about, in a sentence or two. */
  summary: string
  /** What someone can do there today. Keep it to what is online. */
  features: readonly string[]
  /** Where the product lives on this origin; null while it is not online. */
  href: string | null
  /** The product's identity mark and tint (components/visuals). */
  accent: 'transelec' | 'forestal' | 'lidar'
}

export const PRODUCT_CARDS: readonly ProductCard[] = [
  {
    key: 'transelect',
    title: 'Transelec',
    description: 'Seguimiento de planes de manejo forestal y predios asociados.',
    summary:
      'Los planes de manejo (PMF) y predios del proyecto Transelec, leídos de la planilla maestra. Cada cifra se puede rastrear hasta su fila de origen.',
    features: [
      'Estado de cada PMF y su tramitación en CONAF',
      'Predios, superficies y avance por empresa',
      'Importar una planilla nueva y revisarla antes de publicarla',
    ],
    href: '/transelec/',
    accent: 'transelec',
  },
  {
    key: 'forestry',
    title: 'Rodales',
    description: 'Patrimonio Degenfeld: rodales, usos de suelo y superficies.',
    summary:
      'El mapa de rodales del patrimonio Degenfeld sobre imagen satelital, con el uso de suelo y la superficie de cada rodal.',
    features: [
      'Ver y filtrar los rodales en el mapa',
      'Cortar rodales con una línea y armar capas de reporte',
      'Exportar los reportes en SHP, GPKG o Excel',
    ],
    href: '/rodales/',
    accent: 'forestal',
  },
  {
    key: 'lidar',
    title: 'Cubicación LiDAR',
    description: 'Inspección de nubes de puntos de pilas de madera.',
    summary:
      'Medición de pilas de madera a partir de nubes de puntos LiDAR. Se habilitará cuando sus resultados estén validados con mediciones de referencia.',
    features: [],
    href: null,
    accent: 'lidar',
  },
]

export const GOOGLE_LOGIN_PATH = '/api/auth/google/login'
