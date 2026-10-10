import type { Flour } from '../../models'
import type { PantryEntry } from '../flours/pantry'
import type { RecipeConfiguration, PatchIssue, RecipePatch } from '../lab/scenarios'

export type NaturalLanguageIntent = 'configure' | 'modify' | 'question' | 'unsupported'

export interface NaturalLanguageEntity {
  field: string
  value: string | number | boolean
  sourceText: string
  certainty: 'explicit' | 'inherited'
}

export interface NaturalLanguageChoice {
  id: string
  label: string
}

export interface NaturalLanguageAmbiguity {
  field: string
  question: string
  choices?: NaturalLanguageChoice[]
  choicePercentage?: number
}

export interface UnsupportedRequest {
  text: string
  explanation: string
  suggestion: string
}

export interface NaturalLanguageContext {
  currentConfiguration: RecipeConfiguration
  flours: Flour[]
  pantryEntries: PantryEntry[]
  pantryOnly?: boolean
  now: Date
  timeZone: string
}

export interface NaturalLanguageInterpretation {
  intent: NaturalLanguageIntent
  normalizedText: string
  patch: RecipePatch
  proposedConfiguration: RecipeConfiguration | null
  entities: NaturalLanguageEntity[]
  missingInformation: string[]
  ambiguities: NaturalLanguageAmbiguity[]
  validationErrors: PatchIssue[]
  unsupportedRequests: UnsupportedRequest[]
  usePantryOnly: boolean | null
}

export interface NaturalLanguageInterpreter {
  interpret(text: string, context: NaturalLanguageContext): NaturalLanguageInterpretation
}