export interface EmpiricalEstimatorModel {
  id: string
  version: string
  referenceTemperatureC: number | null
  referenceYeastType: string | null
  supportedTemperatureC: [number, number] | null
  supportedYeastPercentage: [number, number] | null
  supportedDurationMinutes: [number, number] | null
  documentedCoefficients: ReadonlyArray<{ name: string; value: number; unit: string; source: string }>
  sourceReferences: ReadonlyArray<string>
  calibrationStatus: 'not-calibrated' | 'calibrated'
  knownLimitations: ReadonlyArray<string>
}

export const YEAST_ESTIMATOR_MODEL: EmpiricalEstimatorModel = {
  id: 'lievia-yeast-empirical',
  version: '0.0.0',
  referenceTemperatureC: null,
  referenceYeastType: null,
  supportedTemperatureC: null,
  supportedYeastPercentage: null,
  supportedDurationMinutes: null,
  documentedCoefficients: [],
  sourceReferences: [],
  calibrationStatus: 'not-calibrated',
  knownLimitations: [
    'Non sono disponibili coefficienti con provenienza documentata e verificabile.',
    'Non è disponibile un dataset di calibrazione rappresentativo per lievito, impasto e profilo termico.',
    'Le osservazioni individuali non vengono usate per addestrare o modificare il modello.',
  ],
}

export interface EstimatorConfiguration {
  version: 1
  selectedModelId: string
  thermalTimeConstantMinutes?: number
  thermalTimeConstantProvenance?: string
  estimatedInitialDoughTemperatureC?: number
  freshPerInstantDry?: number
  freshPerActiveDry?: number
}

export function createDefaultEstimatorConfiguration(): EstimatorConfiguration {
  return { version: 1, selectedModelId: YEAST_ESTIMATOR_MODEL.id }
}

export function normalizeEstimatorConfiguration(value: unknown): EstimatorConfiguration {
  const defaults = createDefaultEstimatorConfiguration()
  if (typeof value !== 'object' || value === null) return defaults
  const candidate = value as Partial<EstimatorConfiguration>
  const positive = (number: unknown) => typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined
  const initial = candidate.estimatedInitialDoughTemperatureC
  return {
    ...defaults,
    thermalTimeConstantMinutes: positive(candidate.thermalTimeConstantMinutes),
    thermalTimeConstantProvenance: typeof candidate.thermalTimeConstantProvenance === 'string' ? candidate.thermalTimeConstantProvenance : undefined,
    estimatedInitialDoughTemperatureC: typeof initial === 'number' && Number.isFinite(initial) && initial >= -10 && initial <= 50 ? initial : undefined,
    freshPerInstantDry: positive(candidate.freshPerInstantDry),
    freshPerActiveDry: positive(candidate.freshPerActiveDry),
  }
}