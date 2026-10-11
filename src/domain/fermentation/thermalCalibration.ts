import type { TemperatureProfile } from './temperatureProfile'

export type TemperatureSampleSplit = 'calibration' | 'validation'

export interface TemperatureMeasurementSample {
  id: string
  phaseId?: string
  at: string
  temperatureC: number
  unit: 'C'
  source: string
  sensorId?: string
  uncertaintyC?: number
  note?: string
  split: TemperatureSampleSplit
}

export function normalizeTemperatureSamples(value: unknown): TemperatureMeasurementSample[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new TypeError('L’archivio misure termiche non è una raccolta valida.')
  const validation = validateTemperatureSamples(value as TemperatureMeasurementSample[])
  if (!validation.valid) throw new TypeError(`Archivio misure termiche non valido: ${validation.errors.join(' ')}`)
  return validation.orderedSamples.map((sample) => ({ ...sample }))
}

export interface ThermalCalibrationRun {
  id: string
  startedAt: string
  initialTemperatureC: number
  environmentTemperatureC: number | null
  environmentSource: string
  samples: TemperatureMeasurementSample[]
  provenance: string
}

export interface ThermalCalibrationDataset {
  schemaVersion: 1
  provenance: 'user-measurements'
  runs: ThermalCalibrationRun[]
  warnings: string[]
}

export interface TemperatureValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  orderedSamples: TemperatureMeasurementSample[]
}

export interface ThermalFitResult {
  status: 'estimated' | 'unavailable'
  timeConstantMinutes: number | null
  calibrationSampleCount: number
  validationSampleCount: number
  calibrationMetrics: ThermalErrorMetrics | null
  validationMetrics: ThermalErrorMetrics | null
  warnings: string[]
}

export interface ThermalErrorMetrics {
  count: number
  maeC: number
  rmseC: number
  points: Array<{ sampleId: string; at: string; measuredC: number; estimatedC: number; residualC: number }>
}

const MIN_TAU_MINUTES = 0.1
const MAX_TAU_MINUTES = 1_000_000

export function validateTemperatureSamples(samples: TemperatureMeasurementSample[]): TemperatureValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const ids = new Set<string>()
  const times = new Set<number>()
  for (const sample of samples) {
    const instant = isIsoTimestamp(sample.at) && Number.isFinite(Date.parse(sample.at)) ? Date.parse(sample.at) : Number.NaN
    if (!sample.id.trim() || ids.has(sample.id)) errors.push('Ogni misura deve avere un identificativo univoco.')
    ids.add(sample.id)
    if (!Number.isFinite(instant)) errors.push(`La data della misura “${sample.id}” non è valida: usa un timestamp ISO completo con fuso orario.`)
    else if (times.has(instant)) errors.push('Sono presenti misure con lo stesso timestamp; correggi o rimuovi il duplicato.')
    else times.add(instant)
    if (sample.unit !== 'C') errors.push(`La misura “${sample.id}” non è espressa in gradi Celsius.`)
    if (!Number.isFinite(sample.temperatureC) || sample.temperatureC < -10 || sample.temperatureC > 50) {
      errors.push(`La temperatura della misura “${sample.id}” deve essere compresa tra -10 e 50 °C.`)
    }
    if (!sample.source.trim()) errors.push(`Indica la provenienza della misura “${sample.id}”.`)
    if (sample.phaseId !== undefined && !sample.phaseId.trim()) errors.push(`La fase associata alla misura “${sample.id}” non è valida.`)
    if (sample.uncertaintyC !== undefined && (!Number.isFinite(sample.uncertaintyC) || sample.uncertaintyC < 0 || sample.uncertaintyC > 10)) {
      errors.push(`L’incertezza della misura “${sample.id}” deve essere compresa tra 0 e 10 °C.`)
    }
    if (sample.split !== 'calibration' && sample.split !== 'validation') errors.push(`Il ruolo della misura “${sample.id}” non è valido.`)
  }
  const orderedSamples = [...samples].sort((first, second) => Date.parse(first.at) - Date.parse(second.at))
  if (orderedSamples.length > 1 && samples.some((sample, index) => index > 0 && Date.parse(sample.at) < Date.parse(samples[index - 1].at))) {
    warnings.push('Le misure sono state riordinate cronologicamente; verifica gli orari inseriti.')
  }
  if (samples.some((sample) => sample.uncertaintyC !== undefined && sample.uncertaintyC > 2)) {
    warnings.push('Alcune misure dichiarano un’incertezza superiore a 2 °C; il confronto ne risente.')
  }
  return { valid: errors.length === 0, errors, warnings, orderedSamples }
}

export function buildThermalCalibrationDataset(runs: ThermalCalibrationRun[]): ThermalCalibrationDataset {
  const warnings: string[] = []
  const runIds = new Set<string>()
  for (const run of runs) {
    if (!run.id.trim() || runIds.has(run.id)) throw new TypeError('Ogni sessione di misure deve avere un identificativo univoco.')
    runIds.add(run.id)
    if (!isIsoTimestamp(run.startedAt) || !Number.isFinite(Date.parse(run.startedAt))) throw new TypeError(`La data iniziale della sessione “${run.id}” non è valida.`)
    if (!Number.isFinite(run.initialTemperatureC) || run.initialTemperatureC < -10 || run.initialTemperatureC > 50) {
      throw new RangeError(`La temperatura iniziale della sessione “${run.id}” non è valida.`)
    }
    if (run.environmentTemperatureC === null || !Number.isFinite(run.environmentTemperatureC)) {
      warnings.push(`Sessione “${run.id}”: temperatura ambientale mancante, esclusa dal fitting.`)
    } else if (run.environmentTemperatureC < -30 || run.environmentTemperatureC > 60) {
      throw new RangeError(`Temperatura ambientale fuori intervallo nella sessione “${run.id}”.`)
    }
    if (!run.environmentSource.trim() || !run.provenance.trim()) throw new TypeError(`Completa la provenienza della sessione “${run.id}”.`)
    const validation = validateTemperatureSamples(run.samples)
    if (!validation.valid) throw new TypeError(validation.errors.join(' '))
    if (validation.orderedSamples.some((sample) => Date.parse(sample.at) < Date.parse(run.startedAt))) {
      throw new RangeError(`Una misura precede l’inizio dichiarato della sessione “${run.id}”.`)
    }
    warnings.push(...validation.warnings.map((warning) => `Sessione “${run.id}”: ${warning}`))
    if (!run.samples.some(({ split }) => split === 'calibration')) warnings.push(`Sessione “${run.id}”: nessun campione assegnato alla stima.`)
  }
  return {
    schemaVersion: 1,
    provenance: 'user-measurements',
    runs: runs.map((run) => ({ ...run, samples: validateTemperatureSamples(run.samples).orderedSamples.map((sample) => ({ ...sample })) })),
    warnings: [...new Set(warnings)],
  }
}

export function fitThermalTimeConstant(dataset: ThermalCalibrationDataset): ThermalFitResult {
  const warnings = [...dataset.warnings]
  const calibration = dataset.runs.flatMap((run) => {
    if (run.environmentTemperatureC === null || !Number.isFinite(run.environmentTemperatureC)) return []
    return run.samples.filter(({ split }) => split === 'calibration').map((sample) => ({
      run,
      sample,
      elapsedMinutes: (Date.parse(sample.at) - Date.parse(run.startedAt)) / 60_000,
    }))
  })
  const validation = dataset.runs.flatMap((run) => {
    if (run.environmentTemperatureC === null || !Number.isFinite(run.environmentTemperatureC)) return []
    return run.samples.filter(({ split }) => split === 'validation').map((sample) => ({
      run,
      sample,
      elapsedMinutes: (Date.parse(sample.at) - Date.parse(run.startedAt)) / 60_000,
    }))
  })
  const unavailable = (warning: string): ThermalFitResult => ({
    status: 'unavailable', timeConstantMinutes: null, calibrationSampleCount: calibration.length,
    validationSampleCount: validation.length, calibrationMetrics: null, validationMetrics: null,
    warnings: [...warnings, warning],
  })
  if (calibration.length < 4) return unavailable('Servono almeno quattro misure reali assegnate alla stima.')
  if (calibration.some(({ elapsedMinutes }) => elapsedMinutes < 0 || !Number.isFinite(elapsedMinutes))) return unavailable('Una misura precede l’inizio dichiarato della sessione o ha una data non valida.')
  if (calibration.some(({ run }) => Math.abs(run.initialTemperatureC - (run.environmentTemperatureC ?? run.initialTemperatureC)) < 0.5)) return unavailable('La temperatura iniziale è troppo vicina all’ambiente per identificare tau.')
  if (dataset.runs.some((run) => run.samples.some(({ split }) => split === 'calibration') && run.environmentTemperatureC === null)) {
    return unavailable('Il fitting richiede una temperatura ambientale nota per ogni sessione inclusa.')
  }
  const informativeRuns = dataset.runs.filter((run) => {
    const points = run.samples.filter(({ split }) => split === 'calibration')
    const times = points.map(({ at }) => Date.parse(at))
    const values = points.map(({ temperatureC }) => temperatureC)
    return points.length >= 3 && Math.max(...times) - Math.min(...times) >= 20 * 60_000 &&
      Math.abs(run.initialTemperatureC - (run.environmentTemperatureC ?? run.initialTemperatureC)) >= 0.5 &&
      Math.max(...values) - Math.min(...values) >= 0.15
  })
  if (!informativeRuns.length) return unavailable('Le osservazioni sono quasi costanti o non coprono tempo e contrasto termico sufficienti per identificare tau.')
  const informativeRunIds = new Set(informativeRuns.map(({ id }) => id))
  const fittingObservations = calibration.filter(({ run }) => informativeRunIds.has(run.id))
  if (fittingObservations.length < calibration.length) warnings.push('Le sessioni con osservazioni non informative sono state escluse dal fitting.')

  const objective = (logTau: number) => {
    const tau = Math.exp(logTau)
    return fittingObservations.reduce((sum, { run, sample, elapsedMinutes }) => {
      const environment = run.environmentTemperatureC!
      const estimated = environment + (run.initialTemperatureC - environment) * Math.exp(-elapsedMinutes / tau)
      return sum + (sample.temperatureC - estimated) ** 2
    }, 0)
  }
  let left = Math.log(MIN_TAU_MINUTES)
  let right = Math.log(MAX_TAU_MINUTES)
  const ratio = (Math.sqrt(5) - 1) / 2
  let first = right - ratio * (right - left)
  let second = left + ratio * (right - left)
  let firstScore = objective(first)
  let secondScore = objective(second)
  for (let iteration = 0; iteration < 160; iteration += 1) {
    if (firstScore <= secondScore) {
      right = second
      second = first
      secondScore = firstScore
      first = right - ratio * (right - left)
      firstScore = objective(first)
    } else {
      left = first
      first = second
      firstScore = secondScore
      second = left + ratio * (right - left)
      secondScore = objective(second)
    }
  }
  const tau = Math.exp((left + right) / 2)
  const residual = objective(Math.log(tau))
  if (!Number.isFinite(tau) || tau <= 0 || !Number.isFinite(residual) || tau < 0.11 || tau > MAX_TAU_MINUTES / 1.01) {
    return unavailable('L’ottimizzazione non ha trovato una costante termica identificabile nei limiti numerici.')
  }
  const calibrationMetrics = calculateMetrics(fittingObservations, tau)
  if (!Number.isFinite(calibrationMetrics.maeC) || !Number.isFinite(calibrationMetrics.rmseC)) return unavailable('Il calcolo dei residui ha prodotto valori non finiti.')
  const validationMetrics = validation.length ? calculateMetrics(validation, tau) : null
  warnings.push('Il valore di tau è una stima sui soli campioni assegnati alla calibrazione, non una validazione indipendente.')
  if (!validation.length) warnings.push('Nessun campione separato è assegnato alla verifica; non è possibile calcolare metriche di validazione.')
  return {
    status: 'estimated', timeConstantMinutes: tau, calibrationSampleCount: fittingObservations.length,
    validationSampleCount: validation.length, calibrationMetrics, validationMetrics, warnings,
  }
}

function calculateMetrics(
  observations: Array<{ run: ThermalCalibrationRun; sample: TemperatureMeasurementSample; elapsedMinutes: number }>,
  tau: number,
): ThermalErrorMetrics {
  const points = observations.map(({ run, sample, elapsedMinutes }) => {
    const estimatedC = run.environmentTemperatureC! +
      (run.initialTemperatureC - run.environmentTemperatureC!) * Math.exp(-elapsedMinutes / tau)
    return { sampleId: sample.id, at: sample.at, measuredC: sample.temperatureC, estimatedC, residualC: sample.temperatureC - estimatedC }
  })
  const maeC = points.reduce((sum, point) => sum + Math.abs(point.residualC), 0) / points.length
  const rmseC = Math.sqrt(points.reduce((sum, point) => sum + point.residualC ** 2, 0) / points.length)
  return { count: points.length, maeC, rmseC, points }
}

export function compareTemperatureSamples(
  profile: TemperatureProfile,
  samples: TemperatureMeasurementSample[],
): ThermalErrorMetrics | null {
  if (profile.status !== 'estimated' || !profile.points.length) return null
  const independentSamples = samples.filter(({ split }) => split === 'validation')
  const validSamples = validateTemperatureSamples(independentSamples)
  if (!validSamples.valid) return null
  const points = validSamples.orderedSamples.flatMap((sample) => {
    const timestamp = Date.parse(sample.at)
    const before = [...profile.points].reverse().find((point) => Date.parse(point.at) <= timestamp && point.doughTemperatureC !== null)
    const after = profile.points.find((point) => Date.parse(point.at) >= timestamp && point.doughTemperatureC !== null)
    if (!before || !after) return []
    const beforeTime = Date.parse(before.at)
    const afterTime = Date.parse(after.at)
    const fraction = afterTime === beforeTime ? 0 : (timestamp - beforeTime) / (afterTime - beforeTime)
    const estimatedC = before.doughTemperatureC! + (after.doughTemperatureC! - before.doughTemperatureC!) * fraction
    const residualC = sample.temperatureC - estimatedC
    return [{ sampleId: sample.id, at: sample.at, measuredC: sample.temperatureC, estimatedC, residualC }]
  })
  if (!points.length) return null
  return {
    count: points.length,
    maeC: points.reduce((sum, point) => sum + Math.abs(point.residualC), 0) / points.length,
    rmseC: Math.sqrt(points.reduce((sum, point) => sum + point.residualC ** 2, 0) / points.length),
    points,
  }
}

function isIsoTimestamp(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return calendarDate.getUTCFullYear() === Number(year) && calendarDate.getUTCMonth() === Number(month) - 1 &&
    calendarDate.getUTCDate() === Number(day) && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59 &&
    (!offsetHour || Number(offsetHour) <= 23 && Number(offsetMinute) <= 59)
}