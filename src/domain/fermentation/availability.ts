import { addDays, addMinutes, setHours, setMinutes, startOfDay } from 'date-fns'
import type { FermentationConfig, FermentationPhase, UserAvailability } from './types'

export interface ScheduleOptimizationResult {
  ok: boolean
  config?: FermentationConfig
  conflicts: string[]
}

const manualPhaseTypes = new Set<FermentationPhase['type']>(['mixing', 'folding', 'dividing'])

export const DEFAULT_USER_AVAILABILITY: UserAvailability = {
  avoidRestHours: true,
  unavailableStart: '23:00',
  unavailableEnd: '08:00',
}

export function isManualPhase(phase: FermentationPhase) {
  return manualPhaseTypes.has(phase.type)
}

export function isWithinAvailableHours(startAt: Date, endAt: Date, availability: UserAvailability) {
  if (!availability.avoidRestHours || startAt.getTime() === endAt.getTime()) return true
  if (endAt < startAt || !isValidTime(availability.unavailableStart) || !isValidTime(availability.unavailableEnd)) return false
  const [unavailableStartHour, unavailableStartMinute] = availability.unavailableStart.split(':').map(Number)
  const [unavailableEndHour, unavailableEndMinute] = availability.unavailableEnd.split(':').map(Number)
  const unavailableStart = unavailableStartHour * 60 + unavailableStartMinute
  const unavailableEnd = unavailableEndHour * 60 + unavailableEndMinute
  if (unavailableStart === unavailableEnd) return true

  for (let cursor = new Date(startAt); cursor < endAt; cursor = addMinutes(cursor, 1)) {
    const minuteOfDay = cursor.getHours() * 60 + cursor.getMinutes()
    const unavailable = unavailableStart < unavailableEnd
      ? minuteOfDay >= unavailableStart && minuteOfDay < unavailableEnd
      : minuteOfDay >= unavailableStart || minuteOfDay < unavailableEnd
    if (unavailable) return false
  }
  return true
}

export function optimizeFermentationSchedule(config: FermentationConfig): ScheduleOptimizationResult {
  const availability = config.availability
  if (!availability?.avoidRestHours) return { ok: true, config, conflicts: [] }
  if (!isValidTime(availability.unavailableStart) || !isValidTime(availability.unavailableEnd)) {
    return failed('Gli orari di indisponibilità non sono validi.')
  }

  const bakeAt = new Date(config.bakingAt)
  if (!Number.isFinite(bakeAt.getTime())) return failed('L’orario di cottura non è valido.')
  const startAt = new Date(bakeAt.getTime() - config.totalDurationMinutes * 60_000)
  const phases = config.phases
  const durationTotal = phases.reduce((total, phase) => total + phase.durationMinutes, 0)
  if (durationTotal !== config.totalDurationMinutes) {
    return failed('La somma delle fasi non coincide con la finestra disponibile.')
  }

  const result: FermentationPhase[] = []
  let phaseIndex = 0
  let segmentStart = startAt

  while (phaseIndex < phases.length) {
    const lockedIndex = phases.findIndex((phase, index) => index >= phaseIndex && isManualPhase(phase) && phase.boundaryLocked)
    const segmentEnd = lockedIndex >= 0 ? new Date(phases[lockedIndex].startAt) : bakeAt
    const segmentPhases = phases.slice(phaseIndex, lockedIndex >= 0 ? lockedIndex : phases.length)
    const scheduled = scheduleSegment(segmentPhases, segmentStart, segmentEnd, availability)
    if (!scheduled.ok) return scheduled
    result.push(...scheduled.phases)

    if (lockedIndex < 0) {
      phaseIndex = phases.length
      break
    }

    const lockedPhase = phases[lockedIndex]
    const lockedStart = new Date(lockedPhase.startAt)
    const lockedEnd = new Date(lockedPhase.endAt)
    if (!Number.isFinite(lockedStart.getTime()) || !Number.isFinite(lockedEnd.getTime()) ||
      lockedEnd.getTime() - lockedStart.getTime() !== lockedPhase.durationMinutes * 60_000) {
      return failed(`L’orario bloccato di “${phaseLabel(lockedPhase)}” non è valido.`)
    }
    if ((lockedPhase.minimumDurationMinutes !== undefined && lockedPhase.durationMinutes < lockedPhase.minimumDurationMinutes) ||
      (lockedPhase.maximumDurationMinutes !== undefined && lockedPhase.durationMinutes > lockedPhase.maximumDurationMinutes)) {
      return failed(`La durata bloccata di “${phaseLabel(lockedPhase)}” viola i limiti configurati.`)
    }
    if (!isWithinAvailableHours(lockedStart, lockedEnd, availability)) {
      return failed(`L’orario bloccato di “${phaseLabel(lockedPhase)}” ricade nelle ore di riposo.`)
    }
    result.push({ ...lockedPhase, startAt: lockedStart.toISOString(), endAt: lockedEnd.toISOString() })
    segmentStart = lockedEnd
    phaseIndex = lockedIndex + 1
  }

  if (phases.length === 0) return failed('Aggiungi almeno una fase al piano.')
  const scheduledTotal = result.reduce((total, phase) => total + phase.durationMinutes, 0)
  if (scheduledTotal !== config.totalDurationMinutes || result.at(-1)?.endAt !== bakeAt.toISOString()) {
    return failed('Le durate minime o massime delle fasi non consentono di raggiungere l’orario di cottura.')
  }

  return {
    ok: true,
    config: { ...config, plannedStartAt: startAt.toISOString(), phases: result },
    conflicts: [],
  }
}

function scheduleSegment(
  phases: FermentationPhase[],
  start: Date,
  end: Date,
  availability: UserAvailability,
): { ok: true; phases: FermentationPhase[] } | { ok: false; conflicts: string[] } {
  if (end < start) return { ok: false, conflicts: ['Un confine bloccato è fuori ordine rispetto alla cottura.'] }
  if (phases.length === 0) return start.getTime() === end.getTime()
    ? { ok: true, phases: [] }
    : { ok: false, conflicts: ['Non ci sono fasi flessibili per coprire l’intervallo fino al prossimo confine.'] }
  let cursor = start
  const output: FermentationPhase[] = []
  let pendingFlexible: FermentationPhase[] = []

  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index]
    if (!isManualPhase(phase)) {
      pendingFlexible.push(phase)
      continue
    }

    const duration = phase.durationMinutes
    if (!Number.isFinite(duration) || duration < 0) return { ok: false, conflicts: [`La durata di “${phaseLabel(phase)}” non è valida.`] }
    if ((phase.minimumDurationMinutes !== undefined && duration < phase.minimumDurationMinutes) ||
      (phase.maximumDurationMinutes !== undefined && duration > phase.maximumDurationMinutes)) {
      return { ok: false, conflicts: [`La durata fissa dell’operazione “${phaseLabel(phase)}” viola i limiti configurati.`] }
    }
    const groupBounds = getDurationBounds(pendingFlexible)
    if (!groupBounds) return { ok: false, conflicts: ['Un limite minimo o massimo di fase non è valido.'] }
    const remainingBounds = getDurationBounds(phases.slice(index + 1).filter((candidate) => !isManualPhase(candidate)))
    const remainingManual = phases.slice(index + 1).filter(isManualPhase).reduce((total, candidate) => total + candidate.durationMinutes, 0)
    if (!remainingBounds) return { ok: false, conflicts: ['Un limite minimo o massimo di fase non è valido.'] }

    const earliest = new Date(cursor.getTime() + groupBounds.minimum * 60_000)
    const latestByGap = Number.isFinite(groupBounds.maximum)
      ? new Date(cursor.getTime() + groupBounds.maximum * 60_000)
      : end
    const latestByRemainingMinimum = new Date(end.getTime() - (duration + remainingManual + remainingBounds.minimum) * 60_000)
    const earliestByRemainingMaximum = Number.isFinite(remainingBounds.maximum)
      ? new Date(end.getTime() - (duration + remainingManual + remainingBounds.maximum) * 60_000)
      : earliest
    const lowerBound = new Date(Math.max(earliest.getTime(), earliestByRemainingMaximum.getTime()))
    const upperBound = new Date(Math.min(latestByGap.getTime(), latestByRemainingMinimum.getTime()))
    const preferred = new Date(phase.startAt)
    const preferredStart = Number.isFinite(preferred.getTime()) ? preferred : earliest
    const candidate = findNearestAvailableStart(lowerBound, upperBound, preferredStart, duration, availability)
    if (!candidate) {
      return { ok: false, conflicts: [`Non c’è una finestra disponibile per l’operazione “${phaseLabel(phase)}” senza violare le durate delle altre fasi.`] }
    }

    const allocated = allocateDurations(pendingFlexible, Math.round((candidate.getTime() - cursor.getTime()) / 60_000))
    if (!allocated) return { ok: false, conflicts: [`I limiti delle fasi prima di “${phaseLabel(phase)}” non consentono di spostare l’operazione.`] }
    output.push(...scheduleFlexible(allocated, cursor))
    const phaseEnd = addMinutes(candidate, duration)
    output.push({ ...phase, startAt: candidate.toISOString(), endAt: phaseEnd.toISOString() })
    cursor = phaseEnd
    pendingFlexible = []
  }

  const trailing = allocateDurations(pendingFlexible, Math.round((end.getTime() - cursor.getTime()) / 60_000))
  if (!trailing) return { ok: false, conflicts: ['Le durate minime o massime delle fasi rimanenti non consentono di raggiungere il prossimo orario bloccato o la cottura.'] }
  output.push(...scheduleFlexible(trailing, cursor))
  if (output.at(-1)?.endAt !== end.toISOString()) {
    return { ok: false, conflicts: ['Le fasi non coprono esattamente l’intervallo fino al prossimo orario bloccato o alla cottura.'] }
  }
  return { ok: true, phases: output }
}

function findNearestAvailableStart(lower: Date, upper: Date, preferred: Date, duration: number, availability: UserAvailability) {
  if (upper < lower) return undefined
  const windows = availableWindows(lower, upper, availability)
  const candidates = windows.flatMap(([windowStart, windowEnd]) => {
    const first = new Date(Math.max(lower.getTime(), windowStart.getTime()))
    const last = new Date(Math.min(upper.getTime(), windowEnd.getTime() - duration * 60_000))
    if (last < first) return []
    const selected = new Date(Math.max(first.getTime(), Math.min(preferred.getTime(), last.getTime())))
    return [selected]
  })
  candidates.sort((left, right) => Math.abs(left.getTime() - preferred.getTime()) - Math.abs(right.getTime() - preferred.getTime()) || left.getTime() - right.getTime())
  return candidates[0]
}

function availableWindows(start: Date, end: Date, availability: UserAvailability): Array<[Date, Date]> {
  const [startHour, startMinute] = availability.unavailableStart.split(':').map(Number)
  const [endHour, endMinute] = availability.unavailableEnd.split(':').map(Number)
  const unavailableStart = startHour * 60 + startMinute
  const unavailableEnd = endHour * 60 + endMinute
  if (unavailableStart === unavailableEnd) return [[start, end]]
  const windows = unavailableStart < unavailableEnd
    ? [[0, unavailableStart], [unavailableEnd, 1440]]
    : [[unavailableEnd, unavailableStart]]
  const result: Array<[Date, Date]> = []
  for (let day = startOfDay(start); day <= end; day = addDays(day, 1)) {
    for (const [windowStartMinute, windowEndMinute] of windows) {
      const windowStart = addMinutes(setMinutes(setHours(day, 0), 0), windowStartMinute)
      const windowEnd = addMinutes(setMinutes(setHours(day, 0), 0), windowEndMinute)
      if (windowEnd >= start && windowStart <= end) result.push([windowStart, windowEnd])
    }
  }
  return result
}

function getDurationBounds(phases: FermentationPhase[]) {
  let minimum = 0
  let maximum = 0
  for (const phase of phases) {
    const phaseMinimum = phase.minimumDurationMinutes ?? 0
    const phaseMaximum = phase.maximumDurationMinutes ?? Number.POSITIVE_INFINITY
    if (!Number.isFinite(phaseMinimum) || phaseMinimum < 0 || Number.isNaN(phaseMaximum) || phaseMaximum < phaseMinimum || phaseMaximum < 0) return undefined
    minimum += phaseMinimum
    maximum += phaseMaximum
  }
  return { minimum, maximum }
}

function allocateDurations(phases: FermentationPhase[], total: number) {
  const bounds = getDurationBounds(phases)
  if (!bounds || total < bounds.minimum || total > bounds.maximum) return undefined
  const durations = phases.map((phase) => Math.max(phase.minimumDurationMinutes ?? 0, Math.min(phase.durationMinutes, phase.maximumDurationMinutes ?? Number.POSITIVE_INFINITY)))
  let delta = total - durations.reduce((sum, duration) => sum + duration, 0)
  const indices = phases.map((_, index) => index)
  for (const index of indices) {
    if (delta === 0) break
    const phase = phases[index]
    const minimum = phase.minimumDurationMinutes ?? 0
    const maximum = phase.maximumDurationMinutes ?? Number.POSITIVE_INFINITY
    const change = delta > 0 ? Math.min(delta, maximum - durations[index]) : -Math.min(-delta, durations[index] - minimum)
    durations[index] += change
    delta -= change
  }
  if (delta !== 0) return undefined
  return phases.map((phase, index) => ({ ...phase, durationMinutes: durations[index] }))
}

function scheduleFlexible(phases: FermentationPhase[], start: Date) {
  let cursor = start
  return phases.map((phase) => {
    const end = addMinutes(cursor, phase.durationMinutes)
    const scheduled = { ...phase, startAt: cursor.toISOString(), endAt: end.toISOString() }
    cursor = end
    return scheduled
  })
}

function isValidTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function phaseLabel(phase: FermentationPhase) {
  const labels: Record<FermentationPhase['type'], string> = {
    mixing: 'Impasto e lavorazione', 'initial-rest': 'Riposo iniziale', 'bulk-fermentation': 'Puntata',
    folding: 'Pieghe', dividing: 'Staglio e formatura', refrigeration: 'Fermentazione in frigorifero',
    'final-proof': 'Appretto', baking: 'Cottura',
  }
  return labels[phase.type]
}

function failed(message: string): ScheduleOptimizationResult {
  return { ok: false, conflicts: [message] }
}