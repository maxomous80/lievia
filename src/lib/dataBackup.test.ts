import { describe, expect, it } from 'vitest'
import { createDefaultDraft } from '../data/defaults'
import type { DoughOutcome } from '../domain/feedback/outcomes'
import { createDefaultEstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import type { Recipe } from '../models'
import { mergeBackup, serializeBackup, type BackupData } from './dataBackup'

const recipe: Recipe = {
  ...createDefaultDraft(),
  id: 'ricetta-1',
  name: 'Impasto',
  version: 1,
  createdAt: '2026-10-10T12:00:00.000Z',
  updatedAt: '2026-10-10T12:00:00.000Z',
}
const flour = { id: 'farina-1', brand: 'Mulino', name: 'Tipo 0', flourType: '0', hydrationNotes: '', isDemo: false }
const outcome: DoughOutcome = {
  version: 1,
  id: 'esito-1',
  recipeId: recipe.id,
  preparedAt: '2026-10-10T12:00:00.000Z',
  actualFermentationDurationMinutes: 720,
  actualRoomTemperatureC: 22,
  actualRefrigeratorTemperatureC: 5,
  yeastType: 'fresh',
  actualYeastQuantityGrams: 1.2,
  doughCondition: 'acceptable',
  notes: 'Buona tenuta',
}
const empty: BackupData = {
  recipes: [], customFlours: [], outcomes: [], calibrationRecords: [],
  estimatorConfiguration: createDefaultEstimatorConfiguration(),
}

describe('backup Lievia', () => {
  it('serializza e importa records senza eseguire o sovrascrivere dati', () => {
    const serialized = serializeBackup({ ...empty, recipes: [recipe], customFlours: [flour] }, '2026-10-10T12:00:00.000Z')
    const result = mergeBackup(serialized, { ...empty, recipes: [recipe], customFlours: [flour] })
    expect(result.added).toEqual({ recipes: 0, customFlours: 0, outcomes: 0, calibrationRecords: 0 })
    expect(result.data.recipes).toEqual([recipe])
    expect(result.data.customFlours).toEqual([flour])
  })

  it('aggiunge record nuovi conservando gli esistenti con lo stesso ID', () => {
    const existing = { ...recipe, name: 'Versione locale' }
    const incoming = { ...recipe, name: 'Versione importata' }
    const newRecipe = { ...recipe, id: 'ricetta-2', name: 'Seconda' }
    const result = mergeBackup(serializeBackup({ ...empty, recipes: [incoming, newRecipe] }), {
      ...empty,
      recipes: [existing],
    })
    expect(result.added.recipes).toBe(1)
    expect(result.data.recipes.map(({ name }) => name)).toEqual(['Versione locale', 'Seconda'])
  })

  it('rifiuta JSON non valido e strutture di backup malformate', () => {
    expect(() => mergeBackup('{', empty)).toThrow(/JSON valido/)
    expect(() => mergeBackup('{"format":"lievia-backup","version":1}', empty)).toThrow(/backup Lievia valido/)
  })

  it('esporta e reimporta gli esiti versionati e rifiuta record non validi', () => {
    const serialized = serializeBackup({ ...empty, recipes: [recipe], outcomes: [outcome] })
    expect(mergeBackup(serialized, empty).data.outcomes).toEqual([outcome])
    const malformed = JSON.parse(serialized) as Record<string, unknown>
    malformed.outcomes = [{ ...outcome, subjectiveScore: 8 }]
    expect(() => mergeBackup(JSON.stringify(malformed), empty)).toThrow(/backup Lievia valido/)
    malformed.outcomes = [outcome]
    malformed.exportedAt = 'data-invalida'
    expect(() => mergeBackup(JSON.stringify(malformed), empty)).toThrow(/backup Lievia valido/)
  })

  it('ripristina impostazioni termiche mancanti ma non sostituisce quelle configurate localmente', () => {
    const importedConfiguration = { ...empty.estimatorConfiguration, thermalTimeConstantMinutes: 135, estimatedInitialDoughTemperatureC: 24 }
    const backup = serializeBackup({ ...empty, estimatorConfiguration: importedConfiguration })
    expect(mergeBackup(backup, empty).data.estimatorConfiguration).toEqual(importedConfiguration)
    const localConfiguration = { ...empty.estimatorConfiguration, freshPerInstantDry: 3.2 }
    expect(mergeBackup(backup, { ...empty, estimatorConfiguration: localConfiguration }).data.estimatorConfiguration)
      .toEqual(localConfiguration)
  })
})