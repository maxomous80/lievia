import { normalizeRecipes } from '../domain/fermentation/migration'
import { isCalibrationRecord, type CalibrationRecord } from '../domain/fermentation/calibration'
import { normalizeEstimatorConfiguration, type EstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import { isDoughOutcome, type DoughOutcome } from '../domain/feedback/outcomes'
import type { Flour, Recipe } from '../models'

export interface LieviaBackup {
  format: 'lievia-backup'
  version: 1
  exportedAt: string
  recipes: Recipe[]
  customFlours: Flour[]
  outcomes: DoughOutcome[]
  calibrationRecords: CalibrationRecord[]
  estimatorConfiguration: EstimatorConfiguration
}

export interface BackupData {
  recipes: Recipe[]
  customFlours: Flour[]
  outcomes: DoughOutcome[]
  calibrationRecords: CalibrationRecord[]
  estimatorConfiguration: EstimatorConfiguration
}

export interface BackupMergeResult {
  data: BackupData
  added: { recipes: number; customFlours: number; outcomes: number; calibrationRecords: number }
}

export function serializeBackup(data: BackupData, exportedAt = new Date().toISOString()): string {
  const backup: LieviaBackup = { format: 'lievia-backup', version: 1, exportedAt, ...data }
  return JSON.stringify(backup, null, 2)
}

export function mergeBackup(serialized: string, current: BackupData): BackupMergeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new TypeError('Il file non contiene JSON valido.')
  }
  if (!isRecord(parsed) || parsed.format !== 'lievia-backup' || parsed.version !== 1 ||
    !isDate(parsed.exportedAt) ||
    !Array.isArray(parsed.recipes) || !Array.isArray(parsed.customFlours) || !Array.isArray(parsed.outcomes) ||
    !Array.isArray(parsed.calibrationRecords) || !parsed.recipes.every(isRecipeShape) ||
    !parsed.customFlours.every(isCustomFlour) || !parsed.outcomes.every(isDoughOutcome) ||
    !parsed.calibrationRecords.every(isCalibrationRecord)) {
    throw new TypeError('Il file non è un backup Lievia valido o contiene dati non riconosciuti.')
  }

  const recipes = normalizeRecipes(parsed.recipes)
  const addedRecipes = appendNewById(current.recipes, recipes)
  const addedFlours = appendNewById(current.customFlours, parsed.customFlours)
  const addedOutcomes = appendNewById(current.outcomes, parsed.outcomes)
  const addedCalibrationRecords = appendNewById(current.calibrationRecords, parsed.calibrationRecords)
  const importedEstimatorConfiguration = normalizeEstimatorConfiguration(parsed.estimatorConfiguration)
  const useImportedEstimatorConfiguration = isDefaultEstimatorConfiguration(current.estimatorConfiguration)
  return {
    data: {
      recipes: [...current.recipes, ...addedRecipes.items],
      customFlours: [...current.customFlours, ...addedFlours.items],
      outcomes: [...current.outcomes, ...addedOutcomes.items],
      calibrationRecords: [...current.calibrationRecords, ...addedCalibrationRecords.items],
      estimatorConfiguration: useImportedEstimatorConfiguration ? importedEstimatorConfiguration : current.estimatorConfiguration,
    },
    added: {
      recipes: addedRecipes.items.length,
      customFlours: addedFlours.items.length,
      outcomes: addedOutcomes.items.length,
      calibrationRecords: addedCalibrationRecords.items.length,
    },
  }
}

function isDefaultEstimatorConfiguration(configuration: EstimatorConfiguration) {
  return configuration.thermalTimeConstantMinutes === undefined &&
    configuration.estimatedInitialDoughTemperatureC === undefined &&
    configuration.freshPerInstantDry === undefined && configuration.freshPerActiveDry === undefined
}

function appendNewById<T extends { id: string }>(existing: T[], incoming: T[]) {
  const seen = new Set(existing.map(({ id }) => id))
  const items = incoming.filter(({ id }) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  return { items }
}

function isRecipeShape(value: unknown): value is Recipe {
  if (!isRecord(value)) return false
  const yeastType = value.yeastType === 'fresh' || value.yeastType === 'instant-dry' || value.yeastType === 'active-dry'
  const styles = ['napoletana', 'contemporanea', 'romana', 'teglia', 'padellino', 'focaccia', 'personalizzato']
  const numericFields = ['ballCount', 'ballWeight', 'hydrationPct', 'saltPct', 'oilPct', 'yeastPct', 'maltPct', 'sugarPct', 'doughWeightPerArea']
  const optionalNumericFields = ['totalDoughWeight', 'panWidth', 'panLength', 'panDiameter']
  const validBlend = Array.isArray(value.flourBlend) && value.flourBlend.length > 0 &&
    value.flourBlend.every((row) => isRecord(row) && typeof row.flourId === 'string' && row.flourId.length > 0 &&
      typeof row.percentage === 'number' && Number.isFinite(row.percentage) && row.percentage >= 0) &&
    Math.abs(value.flourBlend.reduce((sum, row) => sum + (isRecord(row) && typeof row.percentage === 'number' ? row.percentage : 0), 0) - 100) < 1e-6
  return typeof value.id === 'string' && value.id.length > 0 && typeof value.name === 'string' && styles.includes(String(value.style)) &&
    numericFields.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) &&
    optionalNumericFields.every((key) => value[key] === undefined || typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) &&
    typeof value.ballCount === 'number' && value.ballCount > 0 && typeof value.ballWeight === 'number' && value.ballWeight > 0 &&
    typeof value.useTotalWeight === 'boolean' && yeastType && validBlend &&
    (value.useAreaWeight === undefined || typeof value.useAreaWeight === 'boolean') &&
    (value.panShape === undefined || value.panShape === 'rect' || value.panShape === 'round') &&
    isDate(value.createdAt) && isDate(value.updatedAt) && value.version === 1
}

function isCustomFlour(value: unknown): value is Flour {
  if (!isRecord(value)) return false
  return value.isDemo === false && value.officialSource === undefined && typeof value.id === 'string' && typeof value.brand === 'string' &&
    typeof value.name === 'string' && typeof value.flourType === 'string' && typeof value.hydrationNotes === 'string' &&
    ['strengthW', 'plRatio', 'proteinPct'].every((key) => value[key] === undefined ||
      typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) &&
    (value.technicalDataSource === undefined || typeof value.technicalDataSource === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}