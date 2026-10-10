import type { FermentationConfig, FermentationPhase } from './types'

export interface ThermalModelParameters {
  timeConstantMinutes?: number
  initialDoughTemperatureC?: number
}

export interface TemperatureProfilePoint {
  at: string
  phaseId: string
  surroundingEnvironment: 'ambient' | 'refrigerator' | 'dough' | 'custom'
  surroundingTemperatureC: number | null
  surroundingAirTemperatureC: number | null
  ambientTemperatureC: number
  refrigeratorTemperatureC: number
  doughTemperatureC: number | null
  doughTemperatureSource: 'measured' | 'estimated' | 'unknown'
}

export interface TemperatureProfile {
  status: 'estimated' | 'insufficient-data'
  points: TemperatureProfilePoint[]
  explanation: string
}

export function validateThermalParameters(parameters: ThermalModelParameters): string[] {
  const errors: string[] = []
  if (parameters.timeConstantMinutes !== undefined &&
    (!Number.isFinite(parameters.timeConstantMinutes) || parameters.timeConstantMinutes <= 0)) {
    errors.push('La costante termica deve essere un numero positivo.')
  }
  if (parameters.initialDoughTemperatureC !== undefined &&
    (!Number.isFinite(parameters.initialDoughTemperatureC) || parameters.initialDoughTemperatureC < -10 || parameters.initialDoughTemperatureC > 50)) {
    errors.push('La temperatura iniziale dell’impasto deve essere compresa tra -10 e 50 °C.')
  }
  return errors
}

export function calculateTemperatureProfile(
  config: FermentationConfig,
  parameters: ThermalModelParameters = {},
): TemperatureProfile {
  const errors = validateThermalParameters(parameters)
  for (const phase of config.phases) {
    if (!Number.isFinite(phase.durationMinutes) || phase.durationMinutes < 0) {
      errors.push(`La durata della fase ${phase.id} deve essere un numero non negativo.`)
    }
    if (!Number.isFinite(phase.temperatureC) || phase.temperatureC < -30 || phase.temperatureC > 60) {
      errors.push(`La temperatura della fase ${phase.id} deve essere compresa tra -30 e 60 °C.`)
    }
    if (phase.measuredDoughTemperatureC !== undefined &&
      (!Number.isFinite(phase.measuredDoughTemperatureC) || phase.measuredDoughTemperatureC < -10 || phase.measuredDoughTemperatureC > 50)) {
      errors.push(`La misura dell’impasto nella fase ${phase.id} deve essere compresa tra -10 e 50 °C.`)
    }
  }
  if (errors.length) throw new RangeError(errors.join(' '))

  const measuredStart = config.measuredDoughTemperatureC
  const estimatedStart = parameters.initialDoughTemperatureC
  const initial = measuredStart ?? estimatedStart
  const points: TemperatureProfilePoint[] = []
  let doughTemperature = initial ?? null
  let doughTemperatureSource: TemperatureProfilePoint['doughTemperatureSource'] = measuredStart !== undefined
    ? 'measured'
    : estimatedStart !== undefined ? 'estimated' : 'unknown'
  let elapsedMinutes = 0

  for (const phase of config.phases) {
    if (phase.measuredDoughTemperatureC !== undefined) {
      doughTemperature = phase.measuredDoughTemperatureC
      doughTemperatureSource = 'measured'
    }
    const surroundings = surroundingTemperature(config, phase)
    appendPoint(points, phase, elapsedMinutes, surroundings, config, doughTemperature, doughTemperatureSource)

    let remaining = phase.durationMinutes
    while (remaining > 0) {
      const step = Math.min(15, remaining)
      if (doughTemperature !== null && surroundings.temperatureC !== null && parameters.timeConstantMinutes !== undefined) {
        doughTemperature = surroundings.temperatureC + (doughTemperature - surroundings.temperatureC) * Math.exp(-step / parameters.timeConstantMinutes)
        doughTemperatureSource = 'estimated'
      } else if (surroundings.temperatureC === null || parameters.timeConstantMinutes === undefined) {
        doughTemperature = null
        doughTemperatureSource = 'unknown'
      }
      elapsedMinutes += step
      remaining -= step
      appendPoint(points, phase, elapsedMinutes, surroundings, config, doughTemperature, doughTemperatureSource)
    }
  }

  const hasEstimatedPoints = points.some((point) => point.doughTemperatureSource === 'estimated')
  return {
    status: hasEstimatedPoints ? 'estimated' : 'insufficient-data',
    points,
    explanation: hasEstimatedPoints
      ? measuredStart !== undefined
        ? 'La temperatura iniziale è misurata; i punti successivi sono stime del modello termico semplificato, non misure.'
        : estimatedStart !== undefined
          ? 'La temperatura iniziale e i punti successivi sono stime del modello termico semplificato, non misure; l’incertezza non è calibrata.'
          : 'Le misure inserite all’inizio di una fase ancorano i tratti successivi, che sono stime del modello termico semplificato, non misure.'
      : 'Curva non stimata: servono una costante termica esplicita e una temperatura iniziale misurata o inserita come ipotesi.',
  }
}

function surroundingTemperature(config: FermentationConfig, phase: FermentationPhase) {
  if (phase.environment === 'dough') return { environment: 'dough' as const, temperatureC: null, airTemperatureC: null }
  if (phase.environment === 'refrigerator') return { environment: 'refrigerator' as const, temperatureC: config.refrigeratorTemperatureC, airTemperatureC: null }
  if (phase.environment === 'ambient') return { environment: 'ambient' as const, temperatureC: config.ambientTemperatureC, airTemperatureC: config.ambientTemperatureC }
  return { environment: 'custom' as const, temperatureC: phase.temperatureC, airTemperatureC: null }
}

function appendPoint(
  points: TemperatureProfilePoint[],
  phase: FermentationPhase,
  elapsedMinutes: number,
  surroundings: ReturnType<typeof surroundingTemperature>,
  config: FermentationConfig,
  doughTemperatureC: number | null,
  doughTemperatureSource: TemperatureProfilePoint['doughTemperatureSource'],
) {
  const at = new Date(new Date(config.plannedStartAt).getTime() + elapsedMinutes * 60_000).toISOString()
  const previous = points[points.length - 1]
  if (previous?.at === at && previous.phaseId === phase.id) return
  points.push({
    at,
    phaseId: phase.id,
    surroundingEnvironment: surroundings.environment,
    surroundingTemperatureC: surroundings.temperatureC,
    surroundingAirTemperatureC: surroundings.airTemperatureC,
    ambientTemperatureC: config.ambientTemperatureC,
    refrigeratorTemperatureC: config.refrigeratorTemperatureC,
    doughTemperatureC,
    doughTemperatureSource,
  })
}