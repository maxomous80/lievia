import { normalizeRecipes } from '../domain/fermentation/migration'
import { isCalibrationRecord, type CalibrationRecord } from '../domain/fermentation/calibration'
import { normalizeEstimatorConfiguration, type EstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import { isDoughOutcome, type DoughOutcome } from '../domain/feedback/outcomes'
import { normalizePantryEntries, type PantryEntry } from '../domain/flours/pantry'
import { normalizeLabWorkspace, type LabWorkspace } from '../domain/lab/workspace'
import { normalizeTemperatureSamples, validateTemperatureSamples, type TemperatureMeasurementSample } from '../domain/fermentation/thermalCalibration'
import type { Flour, Recipe } from '../models'

export interface LieviaBackup {
  format: 'lievia-backup'
  version: 2
  exportedAt: string
  recipes: Recipe[]
  customFlours: Flour[]
  outcomes: DoughOutcome[]
  calibrationRecords: CalibrationRecord[]
  pantryEntries?: PantryEntry[]
  labWorkspace?: LabWorkspace
  temperatureSamples?: TemperatureMeasurementSample[]
  estimatorConfiguration: EstimatorConfiguration
}

export interface BackupData {
  recipes: Recipe[]
  customFlours: Flour[]
  outcomes: DoughOutcome[]
  calibrationRecords: CalibrationRecord[]
  pantryEntries: PantryEntry[]
  estimatorConfiguration: EstimatorConfiguration
  labWorkspace: LabWorkspace
  temperatureSamples: TemperatureMeasurementSample[]
}

export interface BackupMergeResult {
  data: BackupData
  added: { recipes: number; customFlours: number; outcomes: number; calibrationRecords: number; pantryEntries: number; labSessions: number; temperatureSamples: number }
}

export function serializeBackup(data: BackupData, exportedAt = new Date().toISOString()): string {
  const backup: LieviaBackup = { format: 'lievia-backup', version: 2, exportedAt, ...data }
  return JSON.stringify(backup, null, 2)
}

export function mergeBackup(serialized: string, current: BackupData): BackupMergeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new TypeError('Il file non contiene JSON valido.')
  }
  if (!isRecord(parsed) || parsed.format !== 'lievia-backup' || (parsed.version !== 1 && parsed.version !== 2) ||
    !isDate(parsed.exportedAt) ||
    !Array.isArray(parsed.recipes) || !Array.isArray(parsed.customFlours) || !Array.isArray(parsed.outcomes) ||
    !Array.isArray(parsed.calibrationRecords) || !parsed.recipes.every(isRecipeShape) ||
    !parsed.customFlours.every(isCustomFlour) || !parsed.outcomes.every(isDoughOutcome) ||
    !parsed.calibrationRecords.every(isCalibrationRecord) ||
    (parsed.version === 2 && (!isRecord(parsed.labWorkspace) || !Array.isArray(parsed.labWorkspace.sessions))) ||
    (parsed.temperatureSamples !== undefined && (!Array.isArray(parsed.temperatureSamples) || !validateTemperatureSamples(parsed.temperatureSamples as TemperatureMeasurementSample[]).valid)) ||
    (parsed.pantryEntries !== undefined && (!Array.isArray(parsed.pantryEntries) || !parsed.pantryEntries.every(isPantryEntry)))) {
    throw new TypeError('Il file non è un backup Lievia valido o contiene dati non riconosciuti.')
  }

  const recipes = normalizeRecipes(parsed.recipes)
  if (recipes.length !== parsed.recipes.length) throw new TypeError('Il backup contiene ricette non normalizzabili. Nessun dato è stato importato; recupera o correggi il file.')
  const importedLabWorkspace = parsed.version === 2 ? normalizeLabWorkspace(parsed.labWorkspace) : undefined
  const importedTemperatureSamples = normalizeTemperatureSamples(parsed.temperatureSamples ?? [])
  const addedTemperatureSamples = appendNewById(current.temperatureSamples, importedTemperatureSamples)
  const addedRecipes = appendNewById(current.recipes, recipes)
  const addedFlours = appendNewById(current.customFlours, parsed.customFlours)
  const addedOutcomes = appendNewById(current.outcomes, parsed.outcomes)
  const addedCalibrationRecords = appendNewById(current.calibrationRecords, parsed.calibrationRecords)
  const importedPantryEntries = normalizePantryEntries(parsed.pantryEntries ?? [])
  const addedPantryEntries = appendNewByFlourId(current.pantryEntries, importedPantryEntries)
  const addedLabSessions = importedLabWorkspace
    ? appendNewById(current.labWorkspace.sessions, importedLabWorkspace.sessions)
    : { items: [] as LabWorkspace['sessions'] }
  const importedEstimatorConfiguration = normalizeEstimatorConfiguration(parsed.estimatorConfiguration)
  const useImportedEstimatorConfiguration = isDefaultEstimatorConfiguration(current.estimatorConfiguration)
  return {
    data: {
      recipes: [...current.recipes, ...addedRecipes.items],
      customFlours: [...current.customFlours, ...addedFlours.items],
      outcomes: [...current.outcomes, ...addedOutcomes.items],
      calibrationRecords: [...current.calibrationRecords, ...addedCalibrationRecords.items],
      pantryEntries: [...current.pantryEntries, ...addedPantryEntries.items],
      estimatorConfiguration: useImportedEstimatorConfiguration ? importedEstimatorConfiguration : current.estimatorConfiguration,
      labWorkspace: mergeLabWorkspace(current.labWorkspace, importedLabWorkspace, addedLabSessions.items),
      temperatureSamples: [...current.temperatureSamples, ...addedTemperatureSamples.items],
    },
    added: {
      recipes: addedRecipes.items.length,
      customFlours: addedFlours.items.length,
      outcomes: addedOutcomes.items.length,
      calibrationRecords: addedCalibrationRecords.items.length,
      pantryEntries: addedPantryEntries.items.length,
      labSessions: addedLabSessions.items.length,
      temperatureSamples: addedTemperatureSamples.items.length,
    },
  }
}

function mergeLabWorkspace(current: LabWorkspace, imported: LabWorkspace | undefined, addedSessions: LabWorkspace['sessions']): LabWorkspace {
  if (!imported || !addedSessions.length) return current
  const activeSessionId = imported.activeSessionId && addedSessions.some(({ id }) => id === imported.activeSessionId)
    ? imported.activeSessionId
    : current.activeSessionId
  return { version: 1, activeSessionId, sessions: [...current.sessions, ...addedSessions] }
}

function appendNewByFlourId(existing: PantryEntry[], incoming: PantryEntry[]) {
  const seen = new Set(existing.map(({ flourId }) => flourId))
  const items = incoming.filter(({ flourId }) => {
    if (seen.has(flourId)) return false
    seen.add(flourId)
    return true
  })
  return { items }
}

function isPantryEntry(value: unknown): value is PantryEntry {
  if (!isRecord(value)) return false
  return typeof value.flourId === 'string' && value.flourId.trim().length > 0 &&
    (value.quantityGrams === null || typeof value.quantityGrams === 'number' && Number.isFinite(value.quantityGrams) && value.quantityGrams >= 0) &&
    typeof value.notes === 'string' && isDate(value.updatedAt)
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