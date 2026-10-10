import type { Flour } from '../../models'

export interface NumericRange {
  min: number
  max: number
}

export interface BlendPropertyRanges {
  w: NumericRange | undefined
  pl: NumericRange | undefined
  protein: NumericRange | undefined
}

export function isFlourBlendEligible(flour: Flour) {
  return flour.productKind !== 'prepared-mix'
}

export function deriveBlendPropertyRanges(
  blend: Array<{ flourId: string; percentage: number }>,
  flours: Flour[],
): BlendPropertyRanges {
  return {
    w: deriveRange(blend, flours, 'w'),
    pl: deriveRange(blend, flours, 'pl'),
    protein: deriveRange(blend, flours, 'protein'),
  }
}

function deriveRange(
  blend: Array<{ flourId: string; percentage: number }>,
  flours: Flour[],
  property: 'w' | 'pl' | 'protein',
): NumericRange | undefined {
  if (!blend.length || blend.some(({ percentage }) => !Number.isFinite(percentage) || percentage < 0) ||
    Math.abs(blend.reduce((sum, item) => sum + item.percentage, 0) - 100) > 1e-6) return undefined

  let min = 0
  let max = 0
  for (const item of blend) {
    const flour = flours.find(({ id }) => id === item.flourId)
    if (!flour) return undefined
    const range = sourceRange(flour, property)
    if (!range) return undefined
    min += range.min * item.percentage / 100
    max += range.max * item.percentage / 100
  }
  return { min, max }
}

function sourceRange(flour: Flour, property: 'w' | 'pl' | 'protein'): NumericRange | undefined {
  if (flour.officialSource) {
    const source = flour.officialSource
    const values = property === 'w'
      ? [source.wMin, source.wMax]
      : property === 'pl'
        ? [source.plMin, source.plMax]
        : [source.proteinPercent, source.proteinPercent]
    if (values[0] === null || values[1] === null) return undefined
    return { min: values[0], max: values[1] }
  }

  const value = property === 'w' ? flour.strengthW : property === 'pl' ? flour.plRatio : flour.proteinPct
  return value === undefined ? undefined : { min: value, max: value }
}