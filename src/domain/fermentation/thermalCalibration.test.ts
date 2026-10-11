import { describe, expect, it } from 'vitest'
import {
  buildThermalCalibrationDataset,
  compareTemperatureSamples,
  fitThermalTimeConstant,
  validateTemperatureSamples,
  type TemperatureMeasurementSample,
  type ThermalCalibrationRun,
} from './thermalCalibration'
import { createDefaultFermentationConfig } from './schedule'
import { calculateTemperatureProfile } from './temperatureProfile'

const start = '2026-10-11T08:00:00.000Z'

function sample(id: string, minute: number, temperatureC: number, split: TemperatureMeasurementSample['split'] = 'calibration'): TemperatureMeasurementSample {
  return {
    id,
    at: new Date(Date.parse(start) + minute * 60_000).toISOString(),
    temperatureC,
    unit: 'C',
    source: 'Sonda di riferimento, inserimento manuale',
    sensorId: 'sonda-test-01',
    uncertaintyC: 0.2,
    split,
  }
}

function syntheticRun(tau: number): ThermalCalibrationRun {
  const initialTemperatureC = 25
  const environmentTemperatureC = 5
  const atMinute = (minute: number) => environmentTemperatureC +
    (initialTemperatureC - environmentTemperatureC) * Math.exp(-minute / tau)
  return {
    id: 'run-sintetica-test',
    startedAt: start,
    initialTemperatureC,
    environmentTemperatureC,
    environmentSource: 'Temperatura controllata dichiarata nel fixture sintetico',
    provenance: 'Fixture sintetico esclusivamente per test automatico',
    samples: [
      sample('cal-1', 15, atMinute(15)),
      sample('cal-2', 45, atMinute(45)),
      sample('cal-3', 90, atMinute(90)),
      sample('cal-4', 180, atMinute(180)),
      sample('val-1', 240, atMinute(240), 'validation'),
    ],
  }
}

describe('misure e preparazione calibrazione termica', () => {
  it('ordina i campioni e avvisa quando l’ordine fornito non è cronologico', () => {
    const result = validateTemperatureSamples([sample('seconda', 60, 19), sample('prima', 30, 20)])
    expect(result.valid).toBe(true)
    expect(result.orderedSamples.map(({ id }) => id)).toEqual(['prima', 'seconda'])
    expect(result.warnings).toContain('Le misure sono state riordinate cronologicamente; verifica gli orari inseriti.')
  })

  it('rifiuta timestamp, temperature, unità, sorgenti e duplicati non validi', () => {
    const invalid = [
      sample('dup', 10, 20),
      { ...sample('dup', 10, Number.NaN), unit: 'F' as 'C', source: '' },
      { ...sample('data', 20, 20), at: 'non-una-data' },
    ]
    const result = validateTemperatureSamples(invalid)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('identificativo univoco')
    expect(result.errors.join(' ')).toContain('timestamp')
    expect(result.errors.join(' ')).toContain('gradi Celsius')
    expect(result.errors.join(' ')).toContain('provenienza')
    expect(result.errors.join(' ')).toContain('temperatura')
  })

  it('rifiuta timestamp ISO impossibili e campioni precedenti alla sessione', () => {
    expect(validateTemperatureSamples([{ ...sample('impossibile', 0, 20), at: '2026-02-30T08:00:00.000Z' }]).valid).toBe(false)
    const beforeStart = { ...sample('precedente', 0, 20), at: new Date(Date.parse(start) - 60_000).toISOString() }
    expect(() => buildThermalCalibrationDataset([{ ...syntheticRun(120), samples: [beforeStart] }])).toThrow(/precede l’inizio/)
  })

  it('costruisce dati reali con provenance e ruoli di calibrazione/verifica separati', () => {
    const dataset = buildThermalCalibrationDataset([syntheticRun(120)])
    expect(dataset.provenance).toBe('user-measurements')
    expect(dataset.runs[0].samples.filter(({ split }) => split === 'calibration')).toHaveLength(4)
    expect(dataset.runs[0].samples.filter(({ split }) => split === 'validation')).toHaveLength(1)
    expect(dataset.runs[0].provenance).toContain('sintetico')
  })

  it('stima tau da fixture sintetico e calcola residui e MAE/RMSE separatamente', () => {
    const fit = fitThermalTimeConstant(buildThermalCalibrationDataset([{ ...syntheticRun(120), id: 'sessione-test-indipendente' }]))
    expect(fit.status).toBe('estimated')
    expect(fit.timeConstantMinutes).toBeCloseTo(120, 1)
    expect(fit.calibrationSampleCount).toBe(4)
    expect(fit.validationSampleCount).toBe(1)
    expect(fit.calibrationMetrics?.maeC).toBeLessThan(0.001)
    expect(fit.calibrationMetrics?.rmseC).toBeLessThan(0.001)
    expect(fit.validationMetrics?.count).toBe(1)
    expect(fit.warnings.join(' ')).toContain('non una validazione indipendente')
  })

  it('non produce parametri per dati insufficienti, quasi costanti o privi di ambiente', () => {
    const run = syntheticRun(120)
    const insufficient = { ...run, samples: run.samples.slice(0, 3) }
    expect(fitThermalTimeConstant(buildThermalCalibrationDataset([insufficient])).status).toBe('unavailable')

    const constant = { ...run, samples: run.samples.map((item) => ({ ...item, temperatureC: 20 })) }
    expect(fitThermalTimeConstant(buildThermalCalibrationDataset([constant])).timeConstantMinutes).toBeNull()

    const missingEnvironment = { ...run, environmentTemperatureC: null }
    const missingFit = fitThermalTimeConstant(buildThermalCalibrationDataset([missingEnvironment]))
    expect(missingFit.status).toBe('unavailable')
    expect(missingFit.warnings.join(' ')).toContain('ambientale')
  })

  it('rifiuta fitting quando i campioni di verifica non sono sostituiti ai dati di calibrazione', () => {
    const validationOnly = { ...syntheticRun(120), samples: syntheticRun(120).samples.map((item) => ({ ...item, split: 'validation' as const })) }
    const fit = fitThermalTimeConstant(buildThermalCalibrationDataset([validationOnly]))
    expect(fit.status).toBe('unavailable')
    expect(fit.timeConstantMinutes).toBeNull()
    expect(fit.calibrationSampleCount).toBe(0)
    expect(fit.validationSampleCount).toBe(5)
  })

  it('confronta misure di verifica con il profilo senza assimilare i campioni', () => {
    const config = {
      ...createDefaultFermentationConfig(new Date(start)),
      measuredDoughTemperatureC: 25,
      ambientTemperatureC: 5,
      phases: [{ ...createDefaultFermentationConfig(new Date(start)).phases[0], durationMinutes: 120, environment: 'ambient' as const, temperatureC: 5 }],
      totalDurationMinutes: 120,
    }
    const points = calculateTemperatureProfile(config, { timeConstantMinutes: 120 })
    const observed = {
      ...sample('verifica', 60, 5 + (25 - 5) * Math.exp(-60 / 120), 'validation'),
      at: new Date(Date.parse(config.plannedStartAt) + 60 * 60_000).toISOString(),
    }
    const metrics = compareTemperatureSamples(points, [observed])
    expect(metrics?.count).toBe(1)
    expect(metrics?.maeC).toBeLessThan(0.001)
    expect(metrics?.rmseC).toBeLessThan(0.001)
  })

  it('non conta i campioni di calibrazione come validazione indipendente', () => {
    const config = {
      ...createDefaultFermentationConfig(new Date(start)),
      measuredDoughTemperatureC: 25,
      ambientTemperatureC: 5,
      phases: [{ ...createDefaultFermentationConfig(new Date(start)).phases[0], durationMinutes: 120, environment: 'ambient' as const, temperatureC: 5 }],
      totalDurationMinutes: 120,
    }
    const profile = calculateTemperatureProfile(config, { timeConstantMinutes: 120 })
    const calibrationSample = { ...sample('calibrazione', 60, 15, 'calibration'), at: new Date(Date.parse(config.plannedStartAt) + 60 * 60_000).toISOString() }
    expect(compareTemperatureSamples(profile, [calibrationSample])).toBeNull()
  })
})