import type { YeastType } from '../../models'
import { isValid, parseISO } from 'date-fns'

export type DoughCondition = 'underproofed' | 'acceptable' | 'overproofed'

export interface DoughOutcome {
  version: 1
  id: string
  recipeId: string
  preparedAt: string
  actualFermentationDurationMinutes: number
  actualRoomTemperatureC: number
  actualRefrigeratorTemperatureC: number
  measuredDoughTemperatureC?: number
  yeastType: YeastType
  actualYeastQuantityGrams: number
  doughCondition: DoughCondition
  subjectiveScore?: number
  notes: string
}

export function isDoughOutcome(value: unknown): value is DoughOutcome {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<DoughOutcome>
  return item.version === 1 && typeof item.id === 'string' && item.id.length > 0 &&
    typeof item.recipeId === 'string' && item.recipeId.length > 0 && isDate(item.preparedAt) &&
    Number.isInteger(item.actualFermentationDurationMinutes) && finiteAtLeast(item.actualFermentationDurationMinutes, 0) &&
    finiteBetween(item.actualRoomTemperatureC, -30, 60) &&
    finiteBetween(item.actualRefrigeratorTemperatureC, -30, 40) &&
    (item.measuredDoughTemperatureC === undefined || finiteBetween(item.measuredDoughTemperatureC, -10, 50)) &&
    isYeastType(item.yeastType) && finiteAtLeast(item.actualYeastQuantityGrams, 0) &&
    (item.doughCondition === 'underproofed' || item.doughCondition === 'acceptable' || item.doughCondition === 'overproofed') &&
    (item.subjectiveScore === undefined || (Number.isInteger(item.subjectiveScore) && item.subjectiveScore >= 1 && item.subjectiveScore <= 5)) &&
    typeof item.notes === 'string'
}

export function normalizeOutcomes(value: unknown): DoughOutcome[] {
  return Array.isArray(value) ? value.filter(isDoughOutcome) : []
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && isValid(parseISO(value))
}

function finiteAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
}

function finiteBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function isYeastType(value: unknown): value is YeastType {
  return value === 'fresh' || value === 'instant-dry' || value === 'active-dry'
}