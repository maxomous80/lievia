import type { FlourBlendItem, YeastType } from '../models'

export interface DoughInput {
  ballCount?: number
  ballWeight?: number
  totalDoughWeight?: number
  useTotalWeight?: boolean
  hydrationPct: number
  saltPct: number
  oilPct: number
  yeastType: YeastType
  yeastPct: number
  maltPct?: number
  sugarPct?: number
  flourBlend: FlourBlendItem[]
}

export interface DoughResult {
  targetDoughWeight: number
  totalDoughWeight: number
  flourWeight: number
  flourQuantities: Array<{ flourId: string; percentage: number; weight: number }>
  waterWeight: number
  saltWeight: number
  oilWeight: number
  yeastWeight: number
  maltWeight: number
  sugarWeight: number
  bakerPercentages: Record<string, number>
}

const MASS_TOLERANCE = 1e-7

function requireNonNegative(name: string, value: number | undefined): number {
  const resolved = value ?? 0
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number`)
  }
  return resolved
}

export function calculateDough(input: DoughInput): DoughResult {
  const targetDoughWeight = input.useTotalWeight
    ? requireNonNegative('totalDoughWeight', input.totalDoughWeight)
    : requireNonNegative('ballCount', input.ballCount) *
      requireNonNegative('ballWeight', input.ballWeight)

  if (!Number.isFinite(targetDoughWeight) || targetDoughWeight <= 0) {
    throw new RangeError('The requested dough weight must be greater than zero')
  }

  const hydrationPct = requireNonNegative('hydrationPct', input.hydrationPct)
  const saltPct = requireNonNegative('saltPct', input.saltPct)
  const oilPct = requireNonNegative('oilPct', input.oilPct)
  const yeastPct = requireNonNegative('yeastPct', input.yeastPct)
  const maltPct = requireNonNegative('maltPct', input.maltPct)
  const sugarPct = requireNonNegative('sugarPct', input.sugarPct)

  if (!Array.isArray(input.flourBlend) || input.flourBlend.length === 0) {
    throw new RangeError('At least one flour is required')
  }
  const blendTotal = input.flourBlend.reduce((sum, item) => {
    const percentage = requireNonNegative('flour percentage', item.percentage)
    if (!item.flourId) throw new RangeError('Every flour must have an ID')
    return sum + percentage
  }, 0)
  if (Math.abs(blendTotal - 100) > 1e-6) {
    throw new RangeError('Flour blend percentages must total 100%')
  }

  const bakerPercentages = {
    water: hydrationPct,
    salt: saltPct,
    oil: oilPct,
    yeast: yeastPct,
    malt: maltPct,
    sugar: sugarPct,
  }
  const totalAddedPct = Object.values(bakerPercentages).reduce((sum, value) => sum + value, 0)
  const flourWeight = targetDoughWeight / (1 + totalAddedPct / 100)
  const weightAt = (percentage: number) => flourWeight * percentage / 100
  const flourQuantities = input.flourBlend.map((item) => ({
    flourId: item.flourId,
    percentage: item.percentage,
    weight: flourWeight * item.percentage / 100,
  }))
  const waterWeight = weightAt(hydrationPct)
  const saltWeight = weightAt(saltPct)
  const oilWeight = weightAt(oilPct)
  const yeastWeight = weightAt(yeastPct)
  const maltWeight = weightAt(maltPct)
  const sugarWeight = weightAt(sugarPct)
  const total = flourWeight + waterWeight + saltWeight + oilWeight + yeastWeight + maltWeight + sugarWeight

  if (Math.abs(total - targetDoughWeight) > MASS_TOLERANCE) {
    throw new Error('Ingredient mass balance is outside the allowed tolerance')
  }

  return {
    targetDoughWeight,
    totalDoughWeight: total,
    flourWeight,
    flourQuantities,
    waterWeight,
    saltWeight,
    oilWeight,
    yeastWeight,
    maltWeight,
    sugarWeight,
    bakerPercentages,
  }
}