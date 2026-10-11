import { describe, expect, it } from 'vitest'
import { createDefaultDraft } from '../../data/defaults'
import { createDefaultFermentationConfig } from '../fermentation/schedule'
import { createRecipeConfiguration } from '../lab/scenarios'
import { createImmutableExperimentSnapshot, isDoughOutcome, normalizeOutcomes, type DoughOutcome } from './outcomes'

const observedAt = '2026-10-11T10:00:00.000Z'

function outcome(): DoughOutcome {
  return {
    version: 1,
    id: 'esito-immutabile',
    recipeId: 'ricetta-cancellabile',
    preparedAt: observedAt,
    actualFermentationDurationMinutes: 240,
    actualRoomTemperatureC: 22,
    actualRefrigeratorTemperatureC: 5,
    yeastType: 'fresh',
    actualYeastQuantityGrams: 1.25,
    doughCondition: 'acceptable',
    notes: '',
  }
}

describe('fotografia immutabile degli esperimenti', () => {
  it('conserva configurazione, farine, ingredienti e unità indipendenti dalla ricetta corrente', () => {
    const fermentation = createDefaultFermentationConfig(new Date(observedAt))
    const configuration = createRecipeConfiguration({ ...createDefaultDraft(), name: 'Ricetta al momento', fermentation }, fermentation)
    const snapshot = createImmutableExperimentSnapshot({
      schemaVersion: 1,
      observedAt,
      recipeConfiguration: configuration,
      ingredients: [{ id: 'sale', massGrams: 16, bakerPercentage: 2.8 }],
      selectedFlours: [{ productId: 'farina-x', brand: 'Mulino', name: 'Tipo 0', flourType: '0', wMin: 250, wMax: 300, plMin: 0.5, plMax: 0.7, proteinPercent: 13, source: 'https://esempio.invalid/farina' }],
      yeast: { type: 'fresh', quantityGrams: 1.25, manufacturer: 'Produttore inserito', lot: 'Lotto inserito' },
      doughMassGrams: 1000,
      doughMassSource: 'recipe-calculation',
      hydrationPct: 65,
      saltPct: 2.8,
      plannedPhases: fermentation.phases.map((phase) => ({ phaseId: phase.id, type: phase.type, startAt: phase.startAt, endAt: phase.endAt, durationMinutes: phase.durationMinutes, environment: phase.environment, temperatureC: phase.temperatureC })),
      initialDoughTemperatureC: null,
      measuredInitialDoughTemperatureC: null,
      ambientTemperatureC: 22,
      refrigeratorTemperatureC: 5,
      temperatureSamples: [],
      provenance: { recipeId: 'ricetta-cancellabile', capturedFrom: 'saved-recipe', userProvidedMeasurementsOnly: true },
      units: { temperature: '°C', mass: 'g', time: 'min', dimensions: 'mm' },
    })
    const saved = { ...outcome(), experimentSnapshot: snapshot }
    const originalHydration = configuration.hydrationPct
    configuration.hydrationPct = 99
    expect(saved.experimentSnapshot?.recipeConfiguration.hydrationPct).toBe(originalHydration)
    expect(saved.experimentSnapshot?.ingredients[0].massGrams).toBe(16)
    expect(saved.experimentSnapshot?.selectedFlours[0].productId).toBe('farina-x')
    expect(saved.experimentSnapshot?.initialDoughTemperatureC).toBeNull()
    expect(isDoughOutcome(saved)).toBe(true)
  })

  it('continua a leggere outcome legacy e mantiene assenti le misure non disponibili', () => {
    const legacy = outcome()
    expect(normalizeOutcomes([legacy])).toEqual([legacy])
    expect(isDoughOutcome({ ...legacy, measuredDoughTemperatureC: undefined })).toBe(true)
    expect(isDoughOutcome({ ...legacy, measuredDoughTemperatureC: 0 })).toBe(true)
  })

  it('rifiuta snapshot con misure non finite o configurazione annidata non valida', () => {
    const legacy = outcome()
    const invalid = { ...legacy, experimentSnapshot: { schemaVersion: 1, temperatureSamples: [{ temperatureC: Number.NaN }] } }
    expect(isDoughOutcome(invalid)).toBe(false)
  })
})