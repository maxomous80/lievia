import { describe, expect, it } from 'vitest'
import {
  createDefaultEstimatorConfiguration,
  normalizeEstimatorConfiguration,
  YEAST_ESTIMATOR_MODEL,
} from './modelConfiguration'

describe('configurazione modello empirico', () => {
  it('inizializza il modello senza coefficienti o intervalli inventati', () => {
    expect(createDefaultEstimatorConfiguration()).toMatchObject({ version: 1, selectedModelId: YEAST_ESTIMATOR_MODEL.id })
    expect(YEAST_ESTIMATOR_MODEL).toMatchObject({
      calibrationStatus: 'not-calibrated',
      referenceTemperatureC: null,
      supportedTemperatureC: null,
      supportedYeastPercentage: null,
      supportedDurationMinutes: null,
      documentedCoefficients: [],
      sourceReferences: [],
    })
  })

  it('normalizza impostazioni valide e scarta parametri fuori intervallo', () => {
    expect(normalizeEstimatorConfiguration({
      version: 1,
      thermalTimeConstantMinutes: 120,
      estimatedInitialDoughTemperatureC: 23,
      freshPerInstantDry: 3,
      freshPerActiveDry: 2.5,
    })).toMatchObject({
      thermalTimeConstantMinutes: 120,
      estimatedInitialDoughTemperatureC: 23,
      freshPerInstantDry: 3,
      freshPerActiveDry: 2.5,
    })
    expect(normalizeEstimatorConfiguration({ thermalTimeConstantMinutes: 0, estimatedInitialDoughTemperatureC: 80 }))
      .toEqual(createDefaultEstimatorConfiguration())
  })
})