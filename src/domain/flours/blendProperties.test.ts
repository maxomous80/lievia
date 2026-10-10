import { describe, expect, it } from 'vitest'
import { OFFICIAL_FLOURS } from '../../data/officialFlours'
import type { Flour } from '../../models'
import { deriveBlendPropertyRanges, isFlourBlendEligible } from './blendProperties'

const custom: Flour = {
  id: 'custom-1', brand: 'Molino locale', name: 'Tipo 1', flourType: '1',
  strengthW: 300, plRatio: 0.7, proteinPct: 13.5, hydrationNotes: '', isDemo: false,
}

describe('intervalli aritmetici delle miscele', () => {
  it('mantiene gli intervalli commerciali e li combina con i valori locali come scenario indicativo', () => {
    const product = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-001')!
    const ranges = deriveBlendPropertyRanges([
      { flourId: product.id, percentage: 50 },
      { flourId: custom.id, percentage: 50 },
    ], [product, custom])
    expect(ranges.w).toEqual({ min: 280, max: 290 })
    expect(ranges.pl).toEqual({ min: 0.6, max: 0.6499999999999999 })
    expect(ranges.protein).toEqual({ min: 13, max: 13 })
    expect(product.officialSource?.wMin).toBe(260)
    expect(product.officialSource?.wMax).toBe(280)
  })

  it('non inventa intervalli per dati commerciali null o miscele incomplete', () => {
    const missingPl = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-011')!
    const plRanges = deriveBlendPropertyRanges([{ flourId: missingPl.id, percentage: 100 }], [missingPl])
    expect(plRanges.w).toEqual({ min: 200, max: 200 })
    expect(plRanges.pl).toBeUndefined()
    expect(plRanges.protein).toBeUndefined()

    const missingProtein = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-008')!
    const proteinRanges = deriveBlendPropertyRanges([{ flourId: missingProtein.id, percentage: 100 }], [missingProtein])
    expect(proteinRanges.w).toEqual({ min: 310, max: 310 })
    expect(proteinRanges.pl).toEqual({ min: 0.6, max: 0.6 })
    expect(proteinRanges.protein).toBeUndefined()
    expect(deriveBlendPropertyRanges([{ flourId: missingProtein.id, percentage: 70 }], [missingProtein]).w).toBeUndefined()
  })

  it('non tratta un preparato con ingredienti aggiunti come farina nella miscela', () => {
    const prepared = OFFICIAL_FLOURS.find(({ productKind }) => productKind === 'prepared-mix')!
    const blend = OFFICIAL_FLOURS.find(({ productKind }) => productKind === 'commercial-blend')!
    expect(isFlourBlendEligible(prepared)).toBe(false)
    expect(isFlourBlendEligible(blend)).toBe(true)
    expect(isFlourBlendEligible(custom)).toBe(true)
  })
})