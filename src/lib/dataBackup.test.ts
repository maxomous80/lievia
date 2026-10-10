import { describe, expect, it } from 'vitest'
import { createDefaultDraft } from '../data/defaults'
import type { DoughOutcome } from '../domain/feedback/outcomes'
import type { PantryEntry } from '../domain/flours/pantry'
import { createDefaultEstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import { OFFICIAL_FLOURS } from '../data/officialFlours'
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
const pantryEntry: PantryEntry = {
  flourId: 'commercial-flour-1',
  quantityGrams: 1250,
  notes: 'Sacchetto aperto',
  updatedAt: '2026-10-10T12:00:00.000Z',
}
const empty: BackupData = {
  recipes: [], customFlours: [], outcomes: [], calibrationRecords: [], pantryEntries: [],
  estimatorConfiguration: createDefaultEstimatorConfiguration(),
}

describe('backup Lievia', () => {
  it('serializza e importa records senza eseguire o sovrascrivere dati', () => {
    const serialized = serializeBackup({ ...empty, recipes: [recipe], customFlours: [flour] }, '2026-10-10T12:00:00.000Z')
    const result = mergeBackup(serialized, { ...empty, recipes: [recipe], customFlours: [flour] })
    expect(result.added).toEqual({ recipes: 0, customFlours: 0, outcomes: 0, calibrationRecords: 0, pantryEntries: 0 })
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

  it('include la dispensa nei backup e unisce le voci senza sovrascrivere quelle locali', () => {
    const localEntry = { ...pantryEntry, quantityGrams: 900, notes: 'Scorta locale' }
    const incomingEntry = { ...pantryEntry, flourId: 'commercial-flour-2' }
    const backup = serializeBackup({ ...empty, pantryEntries: [pantryEntry, incomingEntry] })
    const result = mergeBackup(backup, { ...empty, pantryEntries: [localEntry] })
    expect(result.data.pantryEntries).toEqual([localEntry, incomingEntry])
    expect(result.added.pantryEntries).toBe(1)
  })

  it('accetta i backup precedenti senza dispensa senza modificare le voci locali', () => {
    const backup = JSON.parse(serializeBackup(empty)) as Record<string, unknown>
    delete backup.pantryEntries
    const result = mergeBackup(JSON.stringify(backup), { ...empty, pantryEntries: [pantryEntry] })
    expect(result.data.pantryEntries).toEqual([pantryEntry])
    expect(result.added.pantryEntries).toBe(0)
  })

  it('rifiuta JSON non valido e strutture di backup malformate', () => {
    expect(() => mergeBackup('{', empty)).toThrow(/JSON valido/)
    expect(() => mergeBackup('{"format":"lievia-backup","version":1}', empty)).toThrow(/backup Lievia valido/)
  })

  it('non accetta prodotti seed ufficiali nel blocco delle farine personali', () => {
    const backup = JSON.parse(serializeBackup(empty)) as Record<string, unknown>
    backup.customFlours = [OFFICIAL_FLOURS[0]]
    expect(() => mergeBackup(JSON.stringify(backup), empty)).toThrow(/backup Lievia valido/)
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