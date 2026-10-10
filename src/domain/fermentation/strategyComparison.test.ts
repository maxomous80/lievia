import { describe, expect, it } from 'vitest'
import { createDefaultFermentationConfig } from './schedule'
import { compareFermentationStrategies } from './strategyComparison'
import { convertYeastDose, yeastPercentageForMassBalance } from './yeast'
import { calculateDough } from '../../lib/calculator'
import { createDefaultDraft } from '../../data/defaults'

describe('confronto strategie', () => {
  it('confronta i tre piani senza creare una graduatoria biologica', () => {
    const result = compareFermentationStrategies(createDefaultFermentationConfig())
    expect(result.map(({ strategy }) => strategy)).toEqual(['room-temperature', 'refrigerated', 'combined'])
    expect(result.find(({ strategy }) => strategy === 'refrigerated')?.refrigeratorMinutes).toBeGreaterThan(0)
    expect(result.every(({ modelSupportedExposureMinutes }) => modelSupportedExposureMinutes === null)).toBe(true)
  })

  it('segnala quando la finestra non lascia spazio alle operazioni', () => {
    const config = { ...createDefaultFermentationConfig(), totalDurationMinutes: 20 }
    const result = compareFermentationStrategies(config)
    expect(result.every(({ config: candidate }) => candidate === null)).toBe(true)
    expect(result[0].warnings[0]).toContain('operazioni')
  })
})

describe('conversione configurabile del lievito', () => {
  it('non applica rapporti predefiniti se mancano le ipotesi', () => {
    expect(convertYeastDose(9, 'instant-dry', 'fresh', {})).toMatchObject({ available: false, amount: null })
  })

  it('applica solo il rapporto configurato dall’utente', () => {
    expect(convertYeastDose(10, 'instant-dry', 'fresh', { freshPerInstantDry: 3 }))
      .toEqual({ available: true, amount: 30 })
    expect(convertYeastDose(5, 'active-dry', 'fresh', { freshPerActiveDry: 2.5 }))
      .toEqual({ available: true, amount: 12.5 })
  })

  it('rifiuta quantità e fattori non validi', () => {
    expect(convertYeastDose(-1, 'fresh', 'instant-dry', { freshPerInstantDry: 3 }).available).toBe(false)
    expect(convertYeastDose(5, 'fresh', 'instant-dry', { freshPerInstantDry: 0 }).available).toBe(false)
  })

  it('mantiene il bilancio dell’impasto applicando una dose convertita', () => {
    const draft = createDefaultDraft('demo-00')
    const before = calculateDough(draft)
    const convertedGrams = before.yeastWeight / 3
    const nonYeastPct = draft.hydrationPct + draft.saltPct + draft.oilPct + draft.maltPct + draft.sugarPct
    const newYeastPct = yeastPercentageForMassBalance(convertedGrams, before.targetDoughWeight, nonYeastPct)
    expect(newYeastPct).not.toBeNull()
    const after = calculateDough({ ...draft, yeastType: 'instant-dry', yeastPct: newYeastPct! })
    expect(after.totalDoughWeight).toBeCloseTo(before.totalDoughWeight, 8)
    expect(after.yeastWeight).toBeCloseTo(convertedGrams, 8)
    expect(yeastPercentageForMassBalance(1000, 1000, 10)).toBeNull()
  })
})