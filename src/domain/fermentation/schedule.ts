import {
  addMinutes,
  addDays,
  format,
  isValid,
  parseISO,
  setHours,
  setMilliseconds,
  setMinutes,
  setSeconds,
  subMinutes,
} from 'date-fns'
import { it } from 'date-fns/locale'
import type { FermentationConfig, FermentationPhase, FermentationPhaseType, FermentationStrategy, TemperatureEnvironment } from './types'
import { DEFAULT_USER_AVAILABILITY } from './availability'

export const PHASE_LABELS: Record<FermentationPhaseType, string> = {
  mixing: 'Impasto e lavorazione',
  'initial-rest': 'Riposo iniziale',
  'bulk-fermentation': 'Puntata',
  folding: 'Pieghe',
  dividing: 'Staglio e formatura',
  refrigeration: 'Fermentazione in frigorifero',
  'final-proof': 'Appretto',
  baking: 'Cottura',
}

export const STRATEGY_LABELS: Record<FermentationStrategy, string> = {
  'room-temperature': 'Tutta a temperatura ambiente',
  refrigerated: 'Prevalentemente in frigorifero',
  combined: 'Ambiente + frigorifero',
  custom: 'Piano personalizzato',
}

export function parseLocalDateTime(value: string): Date {
  const parsed = parseISO(value)
  if (!isValid(parsed)) throw new RangeError('Inserisci una data e un’ora valide')
  return parsed
}

export function toLocalDateTimeValue(iso: string): string {
  return format(parseLocalDateTime(iso), "yyyy-MM-dd'T'HH:mm")
}

export function calculateStartFromBake(bakingAt: string | Date, durationMinutes: number): Date {
  validateDuration(durationMinutes)
  const end = typeof bakingAt === 'string' ? parseLocalDateTime(bakingAt) : bakingAt
  if (!isValid(end)) throw new RangeError('L’orario di cottura non è valido')
  return subMinutes(end, durationMinutes)
}

export function calculateBakeFromStart(startAt: string | Date, durationMinutes: number): Date {
  validateDuration(durationMinutes)
  const start = typeof startAt === 'string' ? parseLocalDateTime(startAt) : startAt
  if (!isValid(start)) throw new RangeError('L’orario di preparazione non è valido')
  return addMinutes(start, durationMinutes)
}

export function phaseDurationTotal(phases: FermentationPhase[]): number {
  return phases.reduce((total, phase) => total + validateDuration(phase.durationMinutes), 0)
}

export function buildSchedule(phases: FermentationPhase[], startAt: string | Date, expectedDurationMinutes?: number): FermentationPhase[] {
  const start = typeof startAt === 'string' ? parseLocalDateTime(startAt) : startAt
  if (!isValid(start)) throw new RangeError('L’orario di preparazione non è valido')
  const total = phaseDurationTotal(phases)
  if (expectedDurationMinutes !== undefined && total !== validateDuration(expectedDurationMinutes)) {
    throw new RangeError('La somma delle fasi deve coincidere con la durata totale')
  }
  let cursor = start
  return phases.map((phase) => {
    const duration = validateDuration(phase.durationMinutes)
    const end = addMinutes(cursor, duration)
    const scheduled = { ...phase, startAt: cursor.toISOString(), endAt: end.toISOString() }
    cursor = end
    return scheduled
  })
}

export function setScheduleAnchor(
  config: FermentationConfig,
  anchor: 'start' | 'bake',
  dateTime: string,
): FermentationConfig {
  const selected = parseLocalDateTime(dateTime)
  const plannedStart = anchor === 'start' ? selected : calculateStartFromBake(selected, config.totalDurationMinutes)
  const baking = anchor === 'bake' ? selected : calculateBakeFromStart(selected, config.totalDurationMinutes)
  const phases = buildSchedule(config.phases, plannedStart, config.totalDurationMinutes)
  preserveLockedBoundaries(config.phases, phases)
  return {
    ...config,
    timeAnchor: anchor,
    plannedStartAt: plannedStart.toISOString(),
    bakingAt: baking.toISOString(),
    phases,
  }
}

export function reanchorExpiredSchedule(config: FermentationConfig, now: Date, preferredBakingAt: string): FermentationConfig {
  if (Date.parse(config.plannedStartAt) >= now.getTime()) return config

  let bakingAt = parseLocalDateTime(preferredBakingAt)
  while (bakingAt.getTime() - config.totalDurationMinutes * 60_000 <= now.getTime()) {
    bakingAt = addDays(bakingAt, 1)
  }
  return setScheduleAnchor(config, 'bake', bakingAt.toISOString())
}

export function updateTotalDuration(config: FermentationConfig, totalDurationMinutes: number): FermentationConfig {
  validateDuration(totalDurationMinutes)
  const baking = config.timeAnchor === 'bake'
    ? parseLocalDateTime(config.bakingAt)
    : calculateBakeFromStart(config.plannedStartAt, totalDurationMinutes)
  const start = config.timeAnchor === 'bake'
    ? calculateStartFromBake(baking, totalDurationMinutes)
    : parseLocalDateTime(config.plannedStartAt)
  const phases = resizePhases(config.phases, totalDurationMinutes)
  const scheduled = buildSchedule(phases, start, totalDurationMinutes)
  preserveLockedBoundaries(config.phases, scheduled)
  return {
    ...config,
    totalDurationMinutes,
    plannedStartAt: start.toISOString(),
    bakingAt: baking.toISOString(),
    phases: scheduled,
  }
}

export function updatePhase(config: FermentationConfig, phaseId: string, changes: Partial<FermentationPhase>): FermentationConfig {
  let found = false
  const phases = config.phases.map((phase) => {
    if (phase.id !== phaseId) return phase
    found = true
    return { ...phase, ...changes, id: phase.id, durationMinutes: validateDuration(changes.durationMinutes ?? phase.durationMinutes) }
  })
  if (!found) throw new RangeError('La fase da modificare non esiste')
  const totalDurationMinutes = phaseDurationTotal(phases)
  const bakeAnchor = config.timeAnchor === 'bake' ? parseLocalDateTime(config.bakingAt) : undefined
  const startAt = bakeAnchor ? calculateStartFromBake(bakeAnchor, totalDurationMinutes) : parseLocalDateTime(config.plannedStartAt)
  const bakingAt = bakeAnchor ?? calculateBakeFromStart(startAt, totalDurationMinutes)
  const scheduled = buildSchedule(phases, startAt, totalDurationMinutes)
  preserveLockedBoundaries(config.phases, scheduled)
  return {
    ...config,
    totalDurationMinutes,
    plannedStartAt: startAt.toISOString(),
    bakingAt: bakingAt.toISOString(),
    phases: scheduled,
    planConfirmed: true,
  }
}

export function addPhase(config: FermentationConfig, phase: FermentationPhase): FermentationConfig {
  const phases = [...config.phases, { ...phase, durationMinutes: validateDuration(phase.durationMinutes) }]
  return updateTotalDuration({ ...config, phases, totalDurationMinutes: phaseDurationTotal(phases) }, phaseDurationTotal(phases))
}

export function removePhase(config: FermentationConfig, phaseId: string): FermentationConfig {
  const phases = config.phases.filter((phase) => phase.id !== phaseId)
  if (phases.length === config.phases.length) throw new RangeError('La fase da rimuovere non esiste')
  const totalDurationMinutes = phaseDurationTotal(phases)
  const bakeAnchor = config.timeAnchor === 'bake' ? parseLocalDateTime(config.bakingAt) : undefined
  const start = bakeAnchor ? calculateStartFromBake(bakeAnchor, totalDurationMinutes) : parseLocalDateTime(config.plannedStartAt)
  const scheduled = buildSchedule(phases, start, totalDurationMinutes)
  preserveLockedBoundaries(config.phases, scheduled)
  return {
    ...config,
    totalDurationMinutes,
    plannedStartAt: start.toISOString(),
    bakingAt: (bakeAnchor ?? calculateBakeFromStart(start, totalDurationMinutes)).toISOString(),
    phases: scheduled,
    planConfirmed: true,
  }
}

export function applyStrategyTemplate(
  config: FermentationConfig,
  strategy: FermentationStrategy,
  durationMinutes = config.totalDurationMinutes,
): FermentationConfig {
  const phases = createStrategyPhases(strategy, durationMinutes, config.ambientTemperatureC, config.refrigeratorTemperatureC)
  const lockedIdsByType = new Map<FermentationPhaseType, string[]>([])
  for (const phase of config.phases.filter((candidate) => candidate.boundaryLocked)) {
    lockedIdsByType.set(phase.type, [...(lockedIdsByType.get(phase.type) ?? []), phase.id])
  }
  const phasesWithLocks = phases.map((phase) => {
    const lockedId = lockedIdsByType.get(phase.type)?.shift()
    return lockedId ? { ...phase, id: lockedId, boundaryLocked: true } : phase
  })
  const bakeAnchor = config.timeAnchor === 'bake' ? parseLocalDateTime(config.bakingAt) : undefined
  const start = bakeAnchor ? calculateStartFromBake(bakeAnchor, durationMinutes) : parseLocalDateTime(config.plannedStartAt)
  const bakingAt = bakeAnchor ?? calculateBakeFromStart(start, durationMinutes)
  const scheduled = buildSchedule(phasesWithLocks, start, durationMinutes)
  preserveLockedBoundaries(config.phases, scheduled)
  return {
    ...config,
    strategy,
    totalDurationMinutes: durationMinutes,
    bakingAt: bakingAt.toISOString(),
    phases: scheduled,
    planConfirmed: true,
  }
}

export function createStrategyPhases(
  strategy: FermentationStrategy,
  durationMinutes: number,
  ambientTemperatureC: number,
  refrigeratorTemperatureC: number,
): FermentationPhase[] {
  validateDuration(durationMinutes)
  const definitions: Array<{ type: FermentationPhaseType; fixed?: number; share?: number; environment: TemperatureEnvironment; note: string }> = [
    { type: 'mixing', fixed: 15, environment: 'ambient', note: 'Operazione manuale: impastare fino a ottenere una massa omogenea.' },
    { type: 'initial-rest', fixed: 20, environment: 'ambient', note: 'Riposo coperto; non è tempo di lavorazione.' },
  ]
  if (strategy === 'room-temperature') {
    definitions.push(
      { type: 'bulk-fermentation', share: 0.58, environment: 'ambient', note: 'Puntata a temperatura ambiente; controlla volume e consistenza.' },
      { type: 'dividing', fixed: 15, environment: 'ambient', note: 'Operazione manuale: dividere e formare i panetti.' },
      { type: 'final-proof', share: 0.42, environment: 'ambient', note: 'Appretto; valuta il panetto, non solo l’orologio.' },
    )
  } else if (strategy === 'refrigerated') {
    definitions.push(
      { type: 'bulk-fermentation', share: 0.12, environment: 'ambient', note: 'Avvio a temperatura ambiente.' },
      { type: 'dividing', fixed: 15, environment: 'ambient', note: 'Operazione manuale: dividere e formare i panetti.' },
      { type: 'refrigeration', share: 0.64, environment: 'refrigerator', note: 'La fermentazione rallenta in frigorifero, non si arresta.' },
      { type: 'final-proof', share: 0.24, environment: 'ambient', note: 'Recupero e appretto a temperatura ambiente.' },
    )
  } else {
    definitions.push(
      { type: 'bulk-fermentation', share: 0.3, environment: 'ambient', note: 'Prima fase di puntata a temperatura ambiente.' },
      { type: 'dividing', fixed: 15, environment: 'ambient', note: 'Operazione manuale: dividere e formare i panetti.' },
      { type: 'refrigeration', share: 0.42, environment: 'refrigerator', note: 'La fermentazione rallenta in frigorifero, non si arresta.' },
      { type: 'final-proof', share: 0.28, environment: 'ambient', note: 'Recupero e appretto prima della stesura.' },
    )
  }
  const fixedTotal = definitions.reduce((sum, definition) => sum + (definition.fixed ?? 0), 0)
  const variableTotal = durationMinutes - fixedTotal
  if (variableTotal < 0) throw new RangeError('La durata deve permettere le operazioni manuali di base')
  const totalShare = definitions.reduce((sum, definition) => sum + (definition.share ?? 0), 0)
  let allocated = 0
  return definitions.map((definition, index) => {
    const isLastVariable = definition.share !== undefined && !definitions.slice(index + 1).some((next) => next.share !== undefined)
    const duration = definition.fixed ?? (isLastVariable
      ? variableTotal - allocated
      : Math.round(variableTotal * (definition.share ?? 0) / totalShare))
    if (definition.share !== undefined) allocated += duration
    const environment = definition.environment
    return {
      id: createPhaseId(),
      type: definition.type,
      durationMinutes: duration,
      startAt: '',
      endAt: '',
      environment,
      temperatureC: environment === 'refrigerator' ? refrigeratorTemperatureC : ambientTemperatureC,
      notes: definition.note,
    }
  })
}

export function createDefaultFermentationConfig(now = new Date()): FermentationConfig {
  const bake = setMilliseconds(setSeconds(setMinutes(setHours(addDays(now, 1), 20), 30), 0), 0)
  const duration = 24 * 60
  const start = subMinutes(bake, duration)
  const config: FermentationConfig = {
    version: 1,
    strategy: 'combined',
    timeAnchor: 'bake',
    totalDurationMinutes: duration,
    plannedStartAt: start.toISOString(),
    bakingAt: bake.toISOString(),
    availability: { ...DEFAULT_USER_AVAILABILITY },
    ambientTemperatureC: 23,
    refrigeratorTemperatureC: 5,
    phases: [],
    yeastMode: 'manual',
    manualYeastUnit: 'percentage',
    yeastType: 'fresh',
    planConfirmed: false,
  }
  const phases = createStrategyPhases(config.strategy, duration, config.ambientTemperatureC, config.refrigeratorTemperatureC)
  return { ...config, phases: buildSchedule(phases, start, duration) }
}

export function formatItalianDateTime(iso: string, includeDate = true): string {
  const date = parseLocalDateTime(iso)
  return format(date, includeDate ? "EEE d MMM, HH:mm" : 'HH:mm', { locale: it })
}

export function formatDuration(minutes: number): string {
  validateDuration(minutes)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return [hours ? `${hours} ${hours === 1 ? 'ora' : 'ore'}` : '', remainder ? `${remainder} min` : '']
    .filter(Boolean).join(' e ') || '0 min'
}

export function validateDuration(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError('La durata deve essere un numero non negativo')
  return Math.round(minutes)
}

export function createPhaseId(): string {
  return `fase-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

export function environmentLabel(environment: TemperatureEnvironment): string {
  return environment === 'ambient' ? 'Ambiente' : environment === 'refrigerator' ? 'Frigorifero' : environment === 'dough' ? 'Impasto' : 'Personalizzata'
}

function preserveLockedBoundaries(previous: FermentationPhase[], next: FermentationPhase[]) {
  const nextById = new Map(next.map((phase) => [phase.id, phase]))
  for (const phase of previous.filter((candidate) => candidate.boundaryLocked)) {
    const updated = nextById.get(phase.id)
    if (!updated) throw new RangeError(`L’operazione bloccata “${PHASE_LABELS[phase.type]}” non può essere rimossa o sostituita senza sbloccarla.`)
    if (updated.startAt !== phase.startAt || updated.endAt !== phase.endAt) {
      throw new RangeError(`L’operazione bloccata “${PHASE_LABELS[phase.type]}” non può essere spostata senza sbloccarla.`)
    }
  }
}

function resizePhases(phases: FermentationPhase[], newTotal: number): FermentationPhase[] {
  if (!phases.length) return []
  const handsOnTypes = new Set<FermentationPhaseType>(['mixing', 'folding', 'dividing'])
  const manual = phases.filter((phase) => handsOnTypes.has(phase.type))
  const flexible = phases.filter((phase) => !handsOnTypes.has(phase.type))
  const fixedTotal = manual.reduce((total, phase) => total + phase.durationMinutes, 0)
  const variableTotal = newTotal - fixedTotal
  if (variableTotal < 0) throw new RangeError('La durata totale è inferiore al tempo previsto per le operazioni manuali')
  if (flexible.length === 0 && variableTotal > 0) {
    throw new RangeError('Aggiungi una fase di riposo o fermentazione per distribuire la durata restante')
  }
  if (manual.some((phase) => phase.minimumDurationMinutes !== undefined && phase.durationMinutes < phase.minimumDurationMinutes ||
    phase.maximumDurationMinutes !== undefined && phase.durationMinutes > phase.maximumDurationMinutes)) {
    throw new RangeError('Una durata fissa di un’operazione manuale viola i limiti configurati')
  }
  let durations = flexible.map((phase) => phase.skipped ? 0 : Math.max(phase.minimumDurationMinutes ?? 0, Math.min(phase.durationMinutes, phase.maximumDurationMinutes ?? Number.POSITIVE_INFINITY)))
  let delta = variableTotal - durations.reduce((sum, duration) => sum + duration, 0)
  for (const [index, phase] of flexible.entries()) {
    if (delta === 0) break
    const minimum = phase.skipped ? 0 : phase.minimumDurationMinutes ?? 0
    const maximum = phase.skipped ? 0 : phase.maximumDurationMinutes ?? Number.POSITIVE_INFINITY
    if (!Number.isFinite(minimum) || minimum < 0 || Number.isNaN(maximum) || maximum < minimum) {
      throw new RangeError(`I limiti configurati per “${PHASE_LABELS[phase.type]}” non sono validi`)
    }
    const change = delta > 0 ? Math.min(delta, maximum - durations[index]) : -Math.min(-delta, durations[index] - minimum)
    durations[index] += change
    delta -= change
  }
  if (delta !== 0) throw new RangeError('I limiti minimi o massimi delle fasi non consentono la durata totale richiesta')
  let flexibleIndex = 0
  return phases.map((phase) => handsOnTypes.has(phase.type)
    ? { ...phase }
    : { ...phase, durationMinutes: durations[flexibleIndex++] })
}