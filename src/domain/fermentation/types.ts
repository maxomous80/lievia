import type { PizzaStyle, YeastType } from '../../models'

export type FermentationStrategy = 'room-temperature' | 'refrigerated' | 'combined' | 'custom'
export type FermentationPhaseType =
  | 'mixing'
  | 'initial-rest'
  | 'bulk-fermentation'
  | 'folding'
  | 'dividing'
  | 'refrigeration'
  | 'final-proof'
  | 'baking'
export type TemperatureEnvironment = 'ambient' | 'dough' | 'refrigerator' | 'custom'
export type YeastMode = 'manual' | 'assisted'
export type ManualYeastUnit = 'percentage' | 'grams'

export interface FermentationPhase {
  id: string
  type: FermentationPhaseType
  durationMinutes: number
  startAt: string
  endAt: string
  environment: TemperatureEnvironment
  temperatureC: number
  measuredDoughTemperatureC?: number
  notes: string
}

export interface FermentationConfig {
  version: 1
  strategy: FermentationStrategy
  timeAnchor: 'start' | 'bake'
  totalDurationMinutes: number
  plannedStartAt: string
  bakingAt: string
  ambientTemperatureC: number
  measuredDoughTemperatureC?: number
  refrigeratorTemperatureC: number
  targetDoughTemperatureC?: number
  phases: FermentationPhase[]
  yeastMode: YeastMode
  manualYeastUnit: ManualYeastUnit
  yeastType: YeastType
  estimatorModelId?: string
  estimatorModelVersion?: string
  userYeastDoseOverride?: { yeastType: YeastType; yeastPct: number; updatedAt: string }
  planConfirmed: boolean
}

export interface FlourGuidanceInput {
  blend: Array<{ flourId: string; percentage: number }>
  flours: Array<{
    id: string
    name: string
    strengthW?: number
    proteinPct?: number
    isDemo?: boolean
  }>
  durationMinutes: number
  hydrationPct: number
  style: PizzaStyle
}

export interface FermentationWarning {
  code: string
  message: string
  basis: 'temperatura inserita' | 'dati farina inseriti' | 'orientamento generale'
}