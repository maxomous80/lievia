import type { FermentationConfig, FermentationPhase, FermentationPhaseType } from './types'

export type ScheduleValidationStatus = 'Piano temporalmente coerente' | 'Piano con avvertenze' | 'Piano non fattibile'

export interface ScheduleValidation {
  status: ScheduleValidationStatus
  temporal: 'coerente' | 'incoerente'
  strategy: 'coerente' | 'incoerente'
  uncertainty: string[]
  conflicts: string[]
}

const requiredByStrategy: Partial<Record<FermentationConfig['strategy'], FermentationPhaseType[]>> = {
  'room-temperature': ['bulk-fermentation', 'final-proof'],
  refrigerated: ['bulk-fermentation', 'refrigeration', 'final-proof'],
  combined: ['bulk-fermentation', 'refrigeration', 'final-proof'],
}

export function validateFermentationSchedule(config: FermentationConfig, options: { checkDurationBounds?: boolean; checkAvailability?: boolean } = {}): ScheduleValidation {
  const temporalConflicts: string[] = []
  const strategyConflicts: string[] = []
  const phases = config.phases
  const durationTotal = phases.reduce((total, phase) => total + phase.durationMinutes, 0)

  if (!Number.isFinite(config.totalDurationMinutes) || config.totalDurationMinutes <= 0 || durationTotal !== config.totalDurationMinutes) {
    temporalConflicts.push('La somma delle fasi non coincide con la durata totale richiesta.')
  }
  let previousEnd: number | undefined
  for (const phase of phases) {
    const start = Date.parse(phase.startAt)
    const end = Date.parse(phase.endAt)
    if (!Number.isFinite(phase.durationMinutes) || phase.durationMinutes < 0 || !Number.isFinite(start) || !Number.isFinite(end) || end - start !== phase.durationMinutes * 60_000) {
      temporalConflicts.push(`La durata o gli orari di “${phase.type}” non sono validi.`)
      continue
    }
    if (previousEnd !== undefined && start !== previousEnd) temporalConflicts.push('Le fasi non formano una sequenza temporale continua.')
    previousEnd = end
    if (options.checkDurationBounds !== false && !phase.skipped && (phase.minimumDurationMinutes !== undefined && phase.durationMinutes < phase.minimumDurationMinutes ||
      phase.maximumDurationMinutes !== undefined && phase.durationMinutes > phase.maximumDurationMinutes)) {
      strategyConflicts.push(`La durata di “${phase.type}” non rispetta i limiti configurati.`)
    }
    if (phase.durationMinutes === 0 && !(phase.optional && phase.skipped)) {
      strategyConflicts.push(`“${phase.type}” ha durata zero senza essere stata indicata come fase opzionale saltata.`)
    }
    if (phase.skipped && (!phase.optional || phase.durationMinutes !== 0)) {
      strategyConflicts.push(`“${phase.type}” può essere saltata solo se opzionale e con durata zero.`)
    }
    if (options.checkAvailability !== false && config.availability?.avoidRestHours &&
      (phase.type === 'mixing' || phase.type === 'folding' || phase.type === 'dividing') &&
      !isWithinAvailableHours(new Date(start), new Date(end), config.availability)) {
      temporalConflicts.push(`“${phase.type}” ricade nelle ore di riposo configurate.`)
    }
  }
  if (phases.length && previousEnd !== Date.parse(config.bakingAt)) temporalConflicts.push('La sequenza delle fasi non termina all’orario di cottura richiesto.')
  if (phases.length && Date.parse(phases[0].startAt) !== Date.parse(config.plannedStartAt)) temporalConflicts.push('La prima fase non coincide con l’inizio pianificato.')

  for (const type of requiredByStrategy[config.strategy] ?? []) {
    const phase = phases.find((candidate) => candidate.type === type && !candidate.skipped)
    if (!phase || phase.durationMinutes <= 0) strategyConflicts.push(`La strategia richiede una fase “${type}” con durata positiva.`)
  }
  if (config.strategy === 'room-temperature' && phases.some((phase) => phase.type === 'refrigeration' && phase.durationMinutes > 0)) {
    strategyConflicts.push('La strategia a temperatura ambiente contiene una fase di frigorifero.')
  }
  if (config.strategy === 'refrigerated' && phases.some((phase) => phase.type === 'final-proof' && phase.environment === 'refrigerator')) {
    strategyConflicts.push('La fase di appretto deve essere distinta dalla permanenza in frigorifero.')
  }

  const conflicts = [...new Set([...temporalConflicts, ...strategyConflicts])]
  const uncertainty = ['Le durate non sono una previsione biologica: il comportamento dipende anche da temperatura dell’impasto, lievito, farina e condizioni reali.']
  const status = conflicts.length ? 'Piano non fattibile'
    : config.yeastMode === 'assisted' ? 'Piano con avvertenze'
      : 'Piano temporalmente coerente'
  return {
    status,
    temporal: temporalConflicts.length ? 'incoerente' : 'coerente',
    strategy: strategyConflicts.length ? 'incoerente' : 'coerente',
    uncertainty,
    conflicts,
  }
}

export function isSkippedOptionalPhase(phase: FermentationPhase) {
  return phase.optional === true && phase.skipped === true && phase.durationMinutes === 0
}

export function isWithinAvailableHours(startAt: Date, endAt: Date, availability: FermentationConfig['availability']) {
  if (!availability.avoidRestHours || startAt.getTime() === endAt.getTime()) return true
  if (endAt < startAt || !isValidTime(availability.unavailableStart) || !isValidTime(availability.unavailableEnd)) return false
  const [unavailableStartHour, unavailableStartMinute] = availability.unavailableStart.split(':').map(Number)
  const [unavailableEndHour, unavailableEndMinute] = availability.unavailableEnd.split(':').map(Number)
  const unavailableStart = unavailableStartHour * 60 + unavailableStartMinute
  const unavailableEnd = unavailableEndHour * 60 + unavailableEndMinute
  if (unavailableStart === unavailableEnd) return true

  for (let cursor = new Date(startAt); cursor < endAt; cursor.setMinutes(cursor.getMinutes() + 1)) {
    const minuteOfDay = cursor.getHours() * 60 + cursor.getMinutes()
    const unavailable = unavailableStart < unavailableEnd
      ? minuteOfDay >= unavailableStart && minuteOfDay < unavailableEnd
      : minuteOfDay >= unavailableStart || minuteOfDay < unavailableEnd
    if (unavailable) return false
  }
  return true
}

function isValidTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}