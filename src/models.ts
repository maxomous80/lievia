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