import { isValid, parseISO } from 'date-fns'
import type { Recipe, YeastType } from '../../models'
import { applyStrategyTemplate, buildSchedule, calculateBakeFromStart, calculateStartFromBake, createDefaultFermentationConfig } from './schedule'
import type { FermentationConfig, FermentationPhase, FermentationPhaseType, FermentationStrategy, TemperatureEnvironment } from './types'
import { DEFAULT_USER_AVAILABILITY } from './availability'

const strategies = new Set<FermentationStrategy>(['room-temperature', 'refrigerated', 'combined', 'custom'])
const phaseTypes = new Set<FermentationPhaseType>(['mixing', 'initial-rest', 'bulk-fermentation', 'folding', 'dividing', 'refrigeration', 'final-proof'])

export function normalizeRecipes(value: unknown): Recipe[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecipeLike).map((recipe) => ({
    ...recipe,
    fermentation: normalizeFermentation(recipe.fermentation, recipe.yeastType),
  }))
}

export function normalizeFermentation(value: unknown, yeastType: YeastType): FermentationConfig {
  const defaults = createDefaultFermentationConfig()
  if (!isRecord(value)) return { ...defaults, yeastType }

  const strategy = typeof value.strategy === 'string' && strategies.has(value.strategy as FermentationStrategy)
    ? value.strategy as FermentationStrategy
    : defaults.strategy
  const ambientTemperatureC = finite(value.ambientTemperatureC) ?? defaults.ambientTemperatureC
  const refrigeratorTemperatureC = finite(value.refrigeratorTemperatureC) ?? defaults.refrigeratorTemperatureC
  const durationLegacy = finite(value.totalDurationMinutes) ?? (finite(value.totalDurationHours) ?? 24) * 60
  const totalDurationMinutes = durationLegacy >= 60 ? Math.round(durationLegacy) : defaults.totalDurationMinutes
  const bakingAt = validDate(value.bakingAt) ?? validDate(value.targetBakeAt) ?? defaults.bakingAt
  const plannedStartAt = validDate(value.plannedStartAt) ?? calculateStartFromBake(bakingAt, totalDurationMinutes).toISOString()
  const selectedYeast = isYeastType(value.yeastType) ? value.yeastType : yeastType
  const validPhases = normalizePhases(value.phases, ambientTemperatureC, refrigeratorTemperatureC)
  let config: FermentationConfig = {
    version: 1,
    strategy,
    timeAnchor: value.timeAnchor === 'start' ? 'start' : 'bake',
    totalDurationMinutes,
    plannedStartAt,
    bakingAt: value.bakingAt ? validDate(value.bakingAt) ?? calculateBakeFromStart(plannedStartAt, totalDurationMinutes).toISOString() : bakingAt,
    availability: normalizeAvailability(value.availability),
    ambientTemperatureC,
    measuredDoughTemperatureC: finite(value.measuredDoughTemperatureC),
    refrigeratorTemperatureC,
    targetDoughTemperatureC: finite(value.targetDoughTemperatureC),
    phases: [],
    yeastMode: value.yeastMode === 'assisted' ? 'assisted' : 'manual',
    manualYeastUnit: value.manualYeastUnit === 'grams' ? 'grams' : 'percentage',
    yeastType: selectedYeast,
    estimatorModelId: typeof value.estimatorModelId === 'string' ? value.estimatorModelId : undefined,
    estimatorModelVersion: typeof value.estimatorModelVersion === 'string' ? value.estimatorModelVersion : undefined,
    userYeastDoseOverride: normalizeYeastOverride(value.userYeastDoseOverride),
    planConfirmed: value.planConfirmed === true,
  }

  if (validPhases.length && validPhases.reduce((sum, phase) => sum + phase.durationMinutes, 0) === totalDurationMinutes) {
    config = { ...config, phases: buildSchedule(validPhases, plannedStartAt, totalDurationMinutes) }
  } else {
    config = applyStrategyTemplate(config, strategy, totalDurationMinutes)
    config.planConfirmed = value.planConfirmed === true
  }
  return config
}

function normalizeAvailability(value: unknown): FermentationConfig['availability'] {
  if (!isRecord(value)) return { ...DEFAULT_USER_AVAILABILITY }
  const time = (candidate: unknown, fallback: string) => typeof candidate === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate) ? candidate : fallback
  return {
    avoidRestHours: typeof value.avoidRestHours === 'boolean' ? value.avoidRestHours : DEFAULT_USER_AVAILABILITY.avoidRestHours,
    unavailableStart: time(value.unavailableStart, DEFAULT_USER_AVAILABILITY.unavailableStart),
    unavailableEnd: time(value.unavailableEnd, DEFAULT_USER_AVAILABILITY.unavailableEnd),
  }
}

function normalizePhases(value: unknown, ambient: number, refrigerator: number): FermentationPhase[] {
  if (!Array.isArray(value)) return []
  const phases: FermentationPhase[] = []
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) continue
    const legacyDuration = finite(entry.durationMinutes) ?? (finite(entry.durationHours) ?? 0) * 60
    if (!Number.isFinite(legacyDuration) || legacyDuration < 0) continue
    const type = phaseTypes.has(entry.type as FermentationPhaseType) ? entry.type as FermentationPhaseType : 'bulk-fermentation'
    const environment: TemperatureEnvironment = entry.environment === 'refrigerator' || type === 'refrigeration' ? 'refrigerator'
      : entry.environment === 'dough' || entry.environment === 'custom' ? entry.environment : 'ambient'
    phases.push({
      id: typeof entry.id === 'string' && entry.id ? entry.id : `fase-migrata-${index + 1}`,
      type,
      durationMinutes: Math.round(legacyDuration),
      startAt: '',
      endAt: '',
      environment,
      temperatureC: finite(entry.temperatureC) ?? (environment === 'refrigerator' ? refrigerator : ambient),
      measuredDoughTemperatureC: finite(entry.measuredDoughTemperatureC),
      notes: typeof entry.notes === 'string' ? entry.notes : typeof entry.note === 'string' ? entry.note : '',
      minimumDurationMinutes: entry.skipped === true ? undefined : finite(entry.minimumDurationMinutes),
      maximumDurationMinutes: entry.skipped === true ? undefined : finite(entry.maximumDurationMinutes),
      boundaryLocked: entry.boundaryLocked === true,
      optional: entry.optional === true,
      skipped: entry.skipped === true,
    })
  }
  return phases
}

function isRecipeLike(value: unknown): value is Recipe {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    typeof value.yeastType === 'string' && typeof value.yeastPct === 'number' && Array.isArray(value.flourBlend)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function validDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const date = parseISO(value)
  return isValid(date) ? date.toISOString() : undefined
}

function isYeastType(value: unknown): value is YeastType {
  return value === 'fresh' || value === 'instant-dry' || value === 'active-dry'
}

function normalizeYeastOverride(value: unknown): FermentationConfig['userYeastDoseOverride'] {
  if (!isRecord(value) || !isYeastType(value.yeastType) || !Number.isFinite(value.yeastPct) ||
    typeof value.yeastPct !== 'number' || value.yeastPct < 0 || typeof value.updatedAt !== 'string' || !validDate(value.updatedAt)) return undefined
  return { yeastType: value.yeastType, yeastPct: value.yeastPct, updatedAt: value.updatedAt }
}