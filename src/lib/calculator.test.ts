import { describe, expect, it } from 'vitest'
import { calculateDough, type DoughInput } from './calculator'

const baseInput: DoughInput = {
  ballCount: 4,
  ballWeight: 250,
  hydrationPct: 65,
  saltPct: 2.8,
  oilPct: 0,
  yeastType: 'fresh',
  yeastPct: 0.2,
  flourBlend: [{ flourId: 'demo-00', percentage: 100 }],
}

describe('calculateDough', () => {
  it('calcola ingredienti e percentuali sul peso della farina', () => {
    const result = calculateDough(baseInput)
    expect(result.flourWeight).toBeCloseTo(595.2381, 3)
    expect(result.waterWeight / result.flourWeight * 100).toBeCloseTo(65)
    expect(result.saltWeight / result.flourWeight * 100).toBeCloseTo(2.8)
    expect(result.targetDoughWeight).toBe(1000)
  })

  it('ripartisce la farina secondo le percentuali della miscela', () => {
    const result = calculateDough({
      ...baseInput,
      flourBlend: [
        { flourId: 'a', percentage: 70 },
        { flourId: 'b', percentage: 30 },
      ],
    })
    expect(result.flourQuantities[0].weight + result.flourQuantities[1].weight)
      .toBeCloseTo(result.flourWeight)
    expect(result.flourQuantities.map(({ percentage }) => percentage)).toEqual([70, 30])
  })

  it('conserva la massa totale anche usando peso totale diretto', () => {
    const result = calculateDough({
      ...baseInput,
      useTotalWeight: true,
      totalDoughWeight: 850,
    })
    expect(result.totalDoughWeight).toBeCloseTo(850, 8)
    expect(result.targetDoughWeight).toBe(850)
  })

  it('gestisce ingredienti opzionali a zero', () => {
    const result = calculateDough(baseInput)
    expect(result.maltWeight).toBe(0)
    expect(result.sugarWeight).toBe(0)
    expect(result.oilWeight).toBe(0)
  })

  it('rifiuta pesi e percentuali non validi', () => {
    expect(() => calculateDough({ ...baseInput, ballWeight: Number.NaN }))
      .toThrow(RangeError)
    expect(() => calculateDough({ ...baseInput, hydrationPct: -1 }))
      .toThrow(RangeError)
    expect(() => calculateDough({ ...baseInput, ballCount: 0 }))
      .toThrow(RangeError)
  })

  it('rifiuta miscele farine che non sommano al 100%', () => {
    expect(() => calculateDough({
      ...baseInput,
      flourBlend: [{ flourId: 'a', percentage: 80 }],
    })).toThrow(/100%/)
  })
})