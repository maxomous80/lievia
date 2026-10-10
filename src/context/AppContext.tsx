import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createSampleRecipe } from '../data/defaults'
import { mergeFlourCatalog, normalizeCustomFlours } from '../data/officialFlours'
import { normalizeRecipes } from '../domain/fermentation/migration'
import { normalizeCalibrationRecords } from '../domain/fermentation/calibration'
import { normalizeEstimatorConfiguration, createDefaultEstimatorConfiguration, type EstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import { normalizeOutcomes, type DoughOutcome } from '../domain/feedback/outcomes'
import { addToPantry, deductPantryStock, normalizePantryEntries, removeFromPantry, updatePantryEntry, type PantryEntry } from '../domain/flours/pantry'
import { normalizeLabWorkspace, type LabWorkspace } from '../domain/lab/workspace'
import { mergeBackup } from '../lib/dataBackup'
import { readStored, writeStored } from '../lib/storage'
import type { Flour, Recipe, RecipeDraft } from '../models'
import { AppContext } from './contextStore'

const FLOURS_KEY = 'lievia.farine.v1'
const PANTRY_KEY = 'lievia.dispensa.v1'
const LAB_KEY = 'lievia.lab.scenarios.v1'
const RECIPES_KEY = 'lievia.ricette.v1'
const OUTCOMES_KEY = 'lievia.esiti.v1'
const ESTIMATOR_KEY = 'lievia.stima.v1'
const CALIBRATION_KEY = 'lievia.calibrazione.v1'

export function AppProvider({ children }: { children: ReactNode }) {
  const [customFlours, setCustomFlours] = useState(() => normalizeCustomFlours(readStored<unknown>(FLOURS_KEY, [])))
  const [pantryEntries, setPantryEntries] = useState(() => normalizePantryEntries(readStored<unknown>(PANTRY_KEY, [])))
  const [labWorkspace, setLabWorkspace] = useState(() => normalizeLabWorkspace(readStored<unknown>(LAB_KEY, null)))
  const [recipes, setRecipes] = useState(() => normalizeRecipes(readStored<unknown>(RECIPES_KEY, [createSampleRecipe()])))
  const [outcomes, setOutcomes] = useState(() => normalizeOutcomes(readStored<unknown>(OUTCOMES_KEY, [])))
  const [calibrationRecords, setCalibrationRecords] = useState(() => normalizeCalibrationRecords(readStored<unknown>(CALIBRATION_KEY, [])))
  const [estimatorConfiguration, setEstimatorConfiguration] = useState(() => normalizeEstimatorConfiguration(
    readStored<unknown>(ESTIMATOR_KEY, createDefaultEstimatorConfiguration()),
  ))
  const flourCatalog = useMemo(() => mergeFlourCatalog(customFlours), [customFlours])

  useEffect(() => writeStored(FLOURS_KEY, customFlours), [customFlours])
  useEffect(() => writeStored(PANTRY_KEY, pantryEntries), [pantryEntries])
  useEffect(() => writeStored(LAB_KEY, labWorkspace), [labWorkspace])
  useEffect(() => writeStored(RECIPES_KEY, recipes), [recipes])
  useEffect(() => writeStored(OUTCOMES_KEY, outcomes), [outcomes])
  useEffect(() => writeStored(CALIBRATION_KEY, calibrationRecords), [calibrationRecords])
  useEffect(() => writeStored(ESTIMATOR_KEY, estimatorConfiguration), [estimatorConfiguration])

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

  function updateEstimatorConfiguration(configuration: EstimatorConfiguration) {
    setEstimatorConfiguration(normalizeEstimatorConfiguration(configuration))
  }

  function saveLabWorkspace(workspace: LabWorkspace) {
    setLabWorkspace(normalizeLabWorkspace(workspace))
  }

  function importBackup(serialized: string) {
    const result = mergeBackup(serialized, { recipes, customFlours, outcomes, calibrationRecords, pantryEntries, estimatorConfiguration })
    setRecipes(result.data.recipes)
    setCustomFlours(result.data.customFlours)
    setOutcomes(result.data.outcomes)
    setCalibrationRecords(result.data.calibrationRecords)
    setPantryEntries(result.data.pantryEntries)
    setEstimatorConfiguration(result.data.estimatorConfiguration)
    return result.added
  }

  return (
    <AppContext.Provider value={{
      flourCatalog, customFlours, pantryEntries, labWorkspace, recipes, outcomes, calibrationRecords, estimatorConfiguration,
      saveFlour, deleteFlour, addPantryFlour, updatePantryFlour, removePantryFlour, deductPantryFlours, saveRecipe, deleteRecipe, addOutcome,
      updateEstimatorConfiguration, saveLabWorkspace, importBackup,
    }}>
      {children}
    </AppContext.Provider>
  )
}