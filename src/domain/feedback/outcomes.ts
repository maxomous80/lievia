import type { YeastType } from '../../models'
import { isValid, parseISO } from 'date-fns'
import { normalizeRecipeConfiguration, type RecipeConfiguration } from '../lab/scenarios'
import { validateTemperatureSamples, type TemperatureMeasurementSample } from '../fermentation/thermalCalibration'

export type DoughCondition = 'underproofed' | 'acceptable' | 'overproofed'

export interface ExperimentSnapshot {
  schemaVersion: 1
  observedAt: string
  recipeConfiguration: RecipeConfiguration
  ingredients: Array<{ id: string; massGrams: number; bakerPercentage: number | null; flourPercentage?: number }>
  selectedFlours: Array<{
    productId: string
    brand: string | null
    name: string | null
    flourType: string | null
    wMin: number | null
    wMax: number | null
    plMin: number | null
    plMax: number | null
    proteinPercent: number | null
    source: string | null
  }>
  yeast: { type: YeastType; quantityGrams: number; manufacturer?: string; lot?: string }
  doughMassGrams: number
  doughMassSource: 'recipe-calculation' | 'measured'
  hydrationPct: number
  saltPct: number
  plannedPhases: Array<{ phaseId: string; type: string; startAt: string; endAt: string; durationMinutes: number; environment: string; temperatureC: number }>
  actualOperations?: Array<{ phaseId: string; startedAt?: string; endedAt?: string }>
  measuredInitialDoughTemperatureC: number | null
  initialDoughTemperatureC: number | null
  ambientTemperatureC: number | null
  refrigeratorTemperatureC: number | null
  temperatureSamples: TemperatureMeasurementSample[]
  geometry?: { doughMassGrams?: number; dimensionsMm?: { length: number; width: number; height: number }; containerMaterial?: string; containerShape?: string; note?: string }
  provenance: { recipeId: string; capturedFrom: 'saved-recipe'; userProvidedMeasurementsOnly: true }
  units: { temperature: '°C'; mass: 'g'; time: 'min'; dimensions: 'mm' }
}

export interface DoughOutcome {
  version: 1
  id: string
  recipeId: string
  preparedAt: string
  actualFermentationDurationMinutes: number
  actualRoomTemperatureC: number
  actualRefrigeratorTemperatureC: number
  measuredDoughTemperatureC?: number
  yeastType: YeastType
  actualYeastQuantityGrams: number
  doughCondition: DoughCondition
  subjectiveScore?: number
  notes: string
  experimentSnapshot?: ExperimentSnapshot
}

export function isDoughOutcome(value: unknown): value is DoughOutcome {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<DoughOutcome>
  return item.version === 1 && typeof item.id === 'string' && item.id.length > 0 &&
    typeof item.recipeId === 'string' && item.recipeId.length > 0 && isDate(item.preparedAt) &&
    Number.isInteger(item.actualFermentationDurationMinutes) && finiteAtLeast(item.actualFermentationDurationMinutes, 0) &&
    finiteBetween(item.actualRoomTemperatureC, -30, 60) &&
    finiteBetween(item.actualRefrigeratorTemperatureC, -30, 40) &&
    (item.measuredDoughTemperatureC === undefined || finiteBetween(item.measuredDoughTemperatureC, -10, 50)) &&
    isYeastType(item.yeastType) && finiteAtLeast(item.actualYeastQuantityGrams, 0) &&
    (item.doughCondition === 'underproofed' || item.doughCondition === 'acceptable' || item.doughCondition === 'overproofed') &&
    (item.subjectiveScore === undefined || (Number.isInteger(item.subjectiveScore) && item.subjectiveScore >= 1 && item.subjectiveScore <= 5)) &&
    typeof item.notes === 'string' &&
    (item.experimentSnapshot === undefined || isExperimentSnapshot(item.experimentSnapshot))
}

export function createImmutableExperimentSnapshot(snapshot: ExperimentSnapshot): ExperimentSnapshot {
  if (!isExperimentSnapshot(snapshot)) throw new TypeError('La fotografia sperimentale non è valida.')
  return JSON.parse(JSON.stringify(snapshot)) as ExperimentSnapshot
}

export function isExperimentSnapshot(value: unknown): value is ExperimentSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isDate(value.observedAt) || !normalizeRecipeConfiguration(value.recipeConfiguration) ||
    !Array.isArray(value.ingredients) || !value.ingredients.every(isIngredientSnapshot) ||
    !Array.isArray(value.selectedFlours) || !value.selectedFlours.every(isFlourSnapshot) ||
    !isRecord(value.yeast) || !isYeastType(value.yeast.type) || !finiteAtLeast(value.yeast.quantityGrams, 0) ||
    !finiteAtLeast(value.doughMassGrams, 0) || (value.doughMassSource !== 'recipe-calculation' && value.doughMassSource !== 'measured') ||
    !finiteAtLeast(value.hydrationPct, 0) || !finiteAtLeast(value.saltPct, 0) ||
    !Array.isArray(value.plannedPhases) || !value.plannedPhases.every(isPlannedPhase) ||
    (value.actualOperations !== undefined && (!Array.isArray(value.actualOperations) || !value.actualOperations.every(isActualOperation)) ) ||
    !nullableFiniteBetween(value.initialDoughTemperatureC, -10, 50) || !nullableFiniteBetween(value.measuredInitialDoughTemperatureC, -10, 50) || !nullableFiniteBetween(value.ambientTemperatureC, -30, 60) ||
    !nullableFiniteBetween(value.refrigeratorTemperatureC, -30, 40) || !Array.isArray(value.temperatureSamples) ||
    !validateTemperatureSamples(value.temperatureSamples as TemperatureMeasurementSample[]).valid ||
    !isRecord(value.provenance) || typeof value.provenance.recipeId !== 'string' || value.provenance.recipeId.length === 0 ||
    value.provenance.capturedFrom !== 'saved-recipe' || value.provenance.userProvidedMeasurementsOnly !== true ||
    !isRecord(value.units) || value.units.temperature !== '°C' || value.units.mass !== 'g' || value.units.time !== 'min' || value.units.dimensions !== 'mm') return false
  if (value.yeast.manufacturer !== undefined && typeof value.yeast.manufacturer !== 'string') return false
  if (value.yeast.lot !== undefined && typeof value.yeast.lot !== 'string') return false
  return value.geometry === undefined || isGeometry(value.geometry)
}

export function normalizeOutcomes(value: unknown): DoughOutcome[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || !value.every(isDoughOutcome)) {
    throw new TypeError('L’archivio degli esiti contiene osservazioni non valide. Nessun dato è stato scartato; recupera una copia valida prima di continuare.')
  }
  return value.map((outcome) => outcome.experimentSnapshot
    ? { ...outcome, experimentSnapshot: createImmutableExperimentSnapshot(outcome.experimentSnapshot) }
    : { ...outcome })
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && isValid(parseISO(value))
}

function finiteAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
}

function finiteBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function isYeastType(value: unknown): value is YeastType {
  return value === 'fresh' || value === 'instant-dry' || value === 'active-dry'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableFiniteBetween(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null || finiteBetween(value, minimum, maximum)
}

function isIngredientSnapshot(value: unknown) {
  return isRecord(value) && typeof value.id === 'string' && finiteAtLeast(value.massGrams, 0) &&
    (value.bakerPercentage === null || finiteAtLeast(value.bakerPercentage, 0)) &&
    (value.flourPercentage === undefined || finiteAtLeast(value.flourPercentage, 0))
}

function isFlourSnapshot(value: unknown) {
  if (!isRecord(value) || typeof value.productId !== 'string') return false
  return ['brand', 'name', 'flourType', 'source'].every((key) => value[key] === null || typeof value[key] === 'string') &&
    ['wMin', 'wMax', 'plMin', 'plMax', 'proteinPercent'].every((key) => value[key] === null || finiteAtLeast(value[key], 0))
}

function isPlannedPhase(value: unknown) {
  return isRecord(value) && typeof value.phaseId === 'string' && typeof value.type === 'string' &&
    isDate(value.startAt) && isDate(value.endAt) && finiteAtLeast(value.durationMinutes, 0) &&
    typeof value.environment === 'string' && Number.isFinite(value.temperatureC)
}

function isActualOperation(value: unknown) {
  return isRecord(value) && typeof value.phaseId === 'string' &&
    (value.startedAt === undefined || isDate(value.startedAt)) &&
    (value.endedAt === undefined || isDate(value.endedAt))
}

function isGeometry(value: unknown) {
  if (!isRecord(value)) return false
  if (value.doughMassGrams !== undefined && !finiteAtLeast(value.doughMassGrams, 0)) return false
  if (value.containerMaterial !== undefined && typeof value.containerMaterial !== 'string') return false
  if (value.containerShape !== undefined && typeof value.containerShape !== 'string') return false
  if (value.note !== undefined && typeof value.note !== 'string') return false
  if (value.dimensionsMm !== undefined) {
    const dimensions = value.dimensionsMm
    if (!isRecord(dimensions) || !['length', 'width', 'height'].every((key) => finiteAtLeast(dimensions[key], 0))) return false
  }
  return true
}