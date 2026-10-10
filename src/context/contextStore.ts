import { createContext } from 'react'
import type { DoughOutcome } from '../domain/feedback/outcomes'
import type { CalibrationRecord } from '../domain/fermentation/calibration'
import type { EstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import type { Flour, Recipe, RecipeDraft } from '../models'

export interface AppContextValue {
  flourCatalog: Flour[]
  customFlours: Flour[]
  recipes: Recipe[]
  outcomes: DoughOutcome[]
  calibrationRecords: CalibrationRecord[]
  estimatorConfiguration: EstimatorConfiguration
  saveFlour: (flour: Flour) => void
  deleteFlour: (id: string) => void
  saveRecipe: (draft: RecipeDraft, recipeId?: string) => Recipe
  deleteRecipe: (id: string) => void
  addOutcome: (outcome: DoughOutcome) => void
  updateEstimatorConfiguration: (configuration: EstimatorConfiguration) => void
  importBackup: (serialized: string) => { recipes: number; customFlours: number; outcomes: number; calibrationRecords: number }
}

export const AppContext = createContext<AppContextValue | null>(null)