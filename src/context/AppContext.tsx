import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createSampleRecipe } from '../data/defaults'
import { mergeFlourCatalog, normalizeCustomFlours } from '../data/officialFlours'
import { normalizeRecipes } from '../domain/fermentation/migration'
import { normalizeCalibrationRecords } from '../domain/fermentation/calibration'
import { normalizeEstimatorConfiguration, createDefaultEstimatorConfiguration, type EstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import { normalizeOutcomes, type DoughOutcome } from '../domain/feedback/outcomes'
import { addToPantry, deductPantryStock, normalizePantryEntries, removeFromPantry, updatePantryEntry, type PantryEntry } from '../domain/flours/pantry'
import { normalizeLabWorkspace, type LabWorkspace } from '../domain/lab/workspace'
import { normalizeTemperatureSamples, type TemperatureMeasurementSample } from '../domain/fermentation/thermalCalibration'
import { mergeBackup } from '../lib/dataBackup'
import { readStored, readStoredStrict, writeStored, writeStoredBatch } from '../lib/storage'
import type { Flour, Recipe, RecipeDraft } from '../models'
import { AppContext } from './contextStore'

const FLOURS_KEY = 'lievia.farine.v1'
const PANTRY_KEY = 'lievia.dispensa.v1'
const LAB_KEY = 'lievia.lab.scenarios.v1'
const RECIPES_KEY = 'lievia.ricette.v1'
const OUTCOMES_KEY = 'lievia.esiti.v1'
const ESTIMATOR_KEY = 'lievia.stima.v1'
const CALIBRATION_KEY = 'lievia.calibrazione.v1'
const TEMPERATURE_SAMPLES_KEY = 'lievia.temperature.samples.v1'

export function AppProvider({ children }: { children: ReactNode }) {
  const [labLoadIssue, setLabLoadIssue] = useState(() => {
    try {
      return { workspace: normalizeLabWorkspace(readStoredStrict<unknown>(LAB_KEY, null)), error: null as string | null }
    } catch (error) {
      return { workspace: { version: 1 as const, activeSessionId: null, sessions: [] }, error: error instanceof Error ? error.message : 'Archivio Lievia Lab non leggibile.' }
    }
  })
  const [thermalLoadIssue, setThermalLoadIssue] = useState(() => {
    try {
      return { samples: normalizeTemperatureSamples(readStoredStrict<unknown>(TEMPERATURE_SAMPLES_KEY, [])), error: null as string | null }
    } catch (error) {
      return { samples: [] as TemperatureMeasurementSample[], error: error instanceof Error ? error.message : 'Archivio delle misure termiche non leggibile.' }
    }
  })
  const [outcomeLoadIssue, setOutcomeLoadIssue] = useState(() => {
    try {
      return { outcomes: normalizeOutcomes(readStoredStrict<unknown>(OUTCOMES_KEY, [])), error: null as string | null }
    } catch (error) {
      return { outcomes: [] as DoughOutcome[], error: error instanceof Error ? error.message : 'Archivio degli esiti non leggibile.' }
    }
  })
  const [storageError, setStorageError] = useState<string | null>(() => {
    const issues = [labLoadIssue.error, thermalLoadIssue.error, outcomeLoadIssue.error].filter((issue): issue is string => issue !== null)
    return issues.length ? `${issues.join(' ')} I dati originali non sono stati sovrascritti; esporta o recupera una copia valida prima di modificarli.` : null
  })
  const [customFlours, setCustomFlours] = useState(() => normalizeCustomFlours(readStored<unknown>(FLOURS_KEY, [])))
  const [pantryEntries, setPantryEntries] = useState(() => normalizePantryEntries(readStored<unknown>(PANTRY_KEY, [])))
  const [labWorkspace, setLabWorkspace] = useState(labLoadIssue.workspace)
  const [temperatureSamples, setTemperatureSamples] = useState(thermalLoadIssue.samples)
  const [recipes, setRecipes] = useState(() => normalizeRecipes(readStored<unknown>(RECIPES_KEY, [createSampleRecipe()])))
  const [outcomes, setOutcomes] = useState(outcomeLoadIssue.outcomes)
  const [calibrationRecords, setCalibrationRecords] = useState(() => normalizeCalibrationRecords(readStored<unknown>(CALIBRATION_KEY, [])))
  const [estimatorConfiguration, setEstimatorConfiguration] = useState(() => normalizeEstimatorConfiguration(
    readStored<unknown>(ESTIMATOR_KEY, createDefaultEstimatorConfiguration()),
  ))
  const flourCatalog = useMemo(() => mergeFlourCatalog(customFlours), [customFlours])

  useEffect(() => {
    const handleStorageError = (event: Event) => setStorageError((event as CustomEvent<{ message: string | null }>).detail.message)
    window.addEventListener('lievia:storage-write', handleStorageError)
    return () => window.removeEventListener('lievia:storage-write', handleStorageError)
  }, [])

  useEffect(() => { writeStored(FLOURS_KEY, customFlours) }, [customFlours])
  useEffect(() => { writeStored(PANTRY_KEY, pantryEntries) }, [pantryEntries])
  useEffect(() => { if (!labLoadIssue.error) writeStored(LAB_KEY, labWorkspace) }, [labLoadIssue.error, labWorkspace])
  useEffect(() => { writeStored(RECIPES_KEY, recipes) }, [recipes])
  useEffect(() => { if (!outcomeLoadIssue.error) writeStored(OUTCOMES_KEY, outcomes) }, [outcomeLoadIssue.error, outcomes])
  useEffect(() => { writeStored(CALIBRATION_KEY, calibrationRecords) }, [calibrationRecords])
  useEffect(() => { writeStored(ESTIMATOR_KEY, estimatorConfiguration) }, [estimatorConfiguration])
  useEffect(() => { if (!thermalLoadIssue.error) writeStored(TEMPERATURE_SAMPLES_KEY, temperatureSamples) }, [thermalLoadIssue.error, temperatureSamples])

  function saveFlour(flour: Flour) {
    if (flour.officialSource) return
    setCustomFlours((current) => [
      ...current.filter((item) => item.id !== flour.id),
      { ...flour, isDemo: false },
    ])
  }

  function deleteFlour(id: string) {
    setCustomFlours((current) => current.filter((flour) => flour.id !== id))
  }

  function addPantryFlour(flourId: string) {
    setPantryEntries((current) => addToPantry(current, flourId))
  }

  function updatePantryFlour(flourId: string, changes: Partial<Pick<PantryEntry, 'quantityGrams' | 'notes'>>) {
    setPantryEntries((current) => updatePantryEntry(current, flourId, changes))
  }

  function removePantryFlour(flourId: string) {
    setPantryEntries((current) => removeFromPantry(current, flourId))
  }

  function deductPantryFlours(blend: RecipeDraft['flourBlend'], flourWeightGrams: number) {
    const result = deductPantryStock(pantryEntries, blend, flourWeightGrams)
    if (result.unavailableIds.length || result.insufficientIds.length) return [...result.unavailableIds, ...result.insufficientIds]
    setPantryEntries(result.entries)
    return []
  }

  function saveRecipe(draft: RecipeDraft, recipeId?: string) {
    const existing = recipeId ? recipes.find((recipe) => recipe.id === recipeId) : undefined
    const now = new Date().toISOString()
    const recipe: Recipe = {
      ...draft,
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: 1,
    }
    setRecipes((current) => [recipe, ...current.filter((item) => item.id !== recipe.id)])
    return recipe
  }

  function deleteRecipe(id: string) {
    setRecipes((current) => current.filter((recipe) => recipe.id !== id))
  }

  function addOutcome(outcome: DoughOutcome) {
    setOutcomes((current) => [outcome, ...current.filter((item) => item.id !== outcome.id)])
  }

  function addTemperatureSample(sample: TemperatureMeasurementSample) {
    setTemperatureSamples((current) => normalizeTemperatureSamples([sample, ...current]))
  }

  function removeTemperatureSample(sampleId: string) {
    setTemperatureSamples((current) => current.filter(({ id }) => id !== sampleId))
  }

  function updateEstimatorConfiguration(configuration: EstimatorConfiguration) {
    setEstimatorConfiguration(normalizeEstimatorConfiguration(configuration))
  }

  function saveLabWorkspace(workspace: LabWorkspace) {
    setLabWorkspace(normalizeLabWorkspace(workspace))
  }

  function importBackup(serialized: string) {
    const result = mergeBackup(serialized, { recipes, customFlours, outcomes, calibrationRecords, pantryEntries, estimatorConfiguration, labWorkspace, temperatureSamples })
    const parsedBackup = JSON.parse(serialized) as { version?: number; labWorkspace?: unknown; temperatureSamples?: unknown }
    const repairsLabArchive = !labLoadIssue.error || parsedBackup.version === 2 && parsedBackup.labWorkspace !== undefined
    const repairsThermalArchive = !thermalLoadIssue.error || Array.isArray(parsedBackup.temperatureSamples)
    const persisted = writeStoredBatch([
      { key: FLOURS_KEY, data: result.data.customFlours },
      { key: PANTRY_KEY, data: result.data.pantryEntries },
      ...(repairsLabArchive ? [{ key: LAB_KEY, data: result.data.labWorkspace }] : []),
      { key: RECIPES_KEY, data: result.data.recipes },
      { key: OUTCOMES_KEY, data: result.data.outcomes },
      { key: CALIBRATION_KEY, data: result.data.calibrationRecords },
      { key: ESTIMATOR_KEY, data: result.data.estimatorConfiguration },
      ...(repairsThermalArchive ? [{ key: TEMPERATURE_SAMPLES_KEY, data: result.data.temperatureSamples }] : []),
    ])
    if (!persisted.ok) throw new Error(persisted.message)
    setRecipes(result.data.recipes)
    setCustomFlours(result.data.customFlours)
    setOutcomes(result.data.outcomes)
    setCalibrationRecords(result.data.calibrationRecords)
    setPantryEntries(result.data.pantryEntries)
    setEstimatorConfiguration(result.data.estimatorConfiguration)
    setLabWorkspace(result.data.labWorkspace)
    setTemperatureSamples(result.data.temperatureSamples)
    if (repairsLabArchive) setLabLoadIssue({ workspace: result.data.labWorkspace, error: null })
    if (repairsThermalArchive) setThermalLoadIssue({ samples: result.data.temperatureSamples, error: null })
    setOutcomeLoadIssue({ outcomes: result.data.outcomes, error: null })
    const remainingIssues = [
      repairsLabArchive ? null : labLoadIssue.error,
      repairsThermalArchive ? null : thermalLoadIssue.error,
    ].filter((issue): issue is string => issue !== null)
    setStorageError(remainingIssues.length ? `${remainingIssues.join(' ')} L’archivio originale è stato conservato; importa un backup v2 valido per sostituirlo.` : null)
    return result.added
  }

  return (
    <AppContext.Provider value={{
      flourCatalog, customFlours, pantryEntries, labWorkspace, recipes, outcomes, calibrationRecords, estimatorConfiguration,
      temperatureSamples,
      storageError, dismissStorageError: () => setStorageError(null),
      saveFlour, deleteFlour, addPantryFlour, updatePantryFlour, removePantryFlour, deductPantryFlours, saveRecipe, deleteRecipe, addOutcome,
      updateEstimatorConfiguration, saveLabWorkspace, importBackup, addTemperatureSample, removeTemperatureSample,
    }}>
      {children}
    </AppContext.Provider>
  )
}