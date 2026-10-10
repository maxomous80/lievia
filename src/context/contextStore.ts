import { createContext } from 'react'
import type { DoughOutcome } from '../domain/feedback/outcomes'
import type { CalibrationRecord } from '../domain/fermentation/calibration'
import type { EstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import type { PantryEntry } from '../domain/flours/pantry'
import type { Flour, Recipe, RecipeDraft } from '../models'

export interface AppContextValue {
  flourCatalog: Flour[]
  customFlours: Flour[]
  pantryEntries: PantryEntry[]
  recipes: Recipe[]
  outcomes: DoughOutcome[]
  calibrationRecords: CalibrationRecord[]
  estimatorConfiguration: EstimatorConfiguration
  saveFlour: (flour: Flour) => void
  deleteFlour: (id: string) => void
  addPantryFlour: (flourId: string) => void
  updatePantryFlour: (flourId: string, changes: Partial<Pick<PantryEntry, 'quantityGrams' | 'notes'>>) => void
  removePantryFlour: (flourId: string) => void
  deductPantryFlours: (blend: RecipeDraft['flourBlend'], flourWeightGrams: number) => string[]
  saveRecipe: (draft: RecipeDraft, recipeId?: string) => Recipe
  deleteRecipe: (id: string) => void
  addOutcome: (outcome: DoughOutcome) => void
  updateEstimatorConfiguration: (configuration: EstimatorConfiguration) => void
  importBackup: (serialized: string) => { recipes: number; customFlours: number; outcomes: number; calibrationRecords: number; pantryEntries: number }
}

export const AppContext = createContext<AppContextValue | null>(null)