import type { FermentationConfig } from './domain/fermentation/types'

export type PizzaStyle =
  | 'napoletana'
  | 'contemporanea'
  | 'romana'
  | 'teglia'
  | 'padellino'
  | 'focaccia'
  | 'personalizzato'

export type YeastType = 'fresh' | 'instant-dry' | 'active-dry'
export type FlourProductKind = 'flour' | 'commercial-blend' | 'prepared-mix'

export interface OfficialFlourSourceRecord {
  id: string
  brand: string
  name: string
  flourType: string | null
  wMin: number | null
  wMax: number | null
  plMin: number | null
  plMax: number | null
  proteinPercent: number | null
  ashContentPercent: number | null
  farinographAbsorptionPercent: number | null
  waterAbsorptionPercent: number | null
  suggestedApplications?: string[]
  source: { type: string; url: string; checkedOn?: string; accessed?: string }
  notes: string | null
  qualityFlags?: string[]
  verifiedFields?: string[]
  productKind: FlourProductKind
  isArchived: boolean
  productIdentity: string
  catalogueSchemaVersion: string | number
  originalRecord: Record<string, unknown>
  imageUrl?: string
}

export interface Flour {
  id: string
  brand: string
  name: string
  flourType: string
  strengthW?: number
  plRatio?: number
  proteinPct?: number
  hydrationNotes: string
  technicalDataSource?: string
  isDemo: boolean
  officialSource?: OfficialFlourSourceRecord
  productKind?: FlourProductKind
}

export interface FlourBlendItem {
  flourId: string
  percentage: number
}

export interface RecipeDraft {
  name: string
  style: PizzaStyle
  ballCount: number
  ballWeight: number
  totalDoughWeight?: number
  useTotalWeight: boolean
  useAreaWeight?: boolean
  panShape?: 'rect' | 'round'
  hydrationPct: number
  saltPct: number
  oilPct: number
  yeastType: YeastType
  yeastPct: number
  maltPct: number
  sugarPct: number
  flourBlend: FlourBlendItem[]
  panWidth?: number
  panLength?: number
  panDiameter?: number
  doughWeightPerArea: number
  fermentation?: FermentationConfig
}

export interface Recipe extends RecipeDraft {
  id: string
  createdAt: string
  updatedAt: string
  version: 1
}

export interface VersionedData<T> {
  version: 1
  data: T
}