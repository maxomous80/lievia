import { afterEach, describe, expect, it } from 'vitest'
import { readStored, writeStored } from '../../lib/storage'
import { addToPantry, deductPantryStock, getStockWarnings, normalizePantryEntries, removeFromPantry, updatePantryEntry } from './pantry'

afterEach(() => window.localStorage.removeItem('lievia.dispensa.test.v1'))

describe('dispensa smart', () => {
  it('normalizza record, ignora schede malformate e deduplica mantenendo la versione più recente', () => {
    const normalized = normalizePantryEntries([
      { flourId: 'caputo-pizzeria', quantityGrams: 750, notes: 'Sacchetto aperto', updatedAt: '2026-01-01T00:00:00.000Z' },
      { flourId: 'caputo-pizzeria', quantityGrams: null, notes: 'Quantità non nota', updatedAt: '2026-02-01T00:00:00.000Z' },
      { flourId: 'custom-1', quantityGrams: -1, notes: '', updatedAt: '' },
      { flourId: 'broken', quantityGrams: 1 },
    ])
    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({ flourId: 'caputo-pizzeria', quantityGrams: null, notes: 'Quantità non nota' })
  })

  it('persiste selezioni, note e quantità separate dal catalogo e aggiorna per ID stabile', () => {
    const added = addToPantry([], 'custom-old-1', '2026-03-01T00:00:00.000Z')
    const edited = updatePantryEntry(added, 'custom-old-1', { quantityGrams: 1250, notes: 'Contenitore ermetico' }, '2026-03-02T00:00:00.000Z')
    writeStored('lievia.dispensa.test.v1', edited)
    expect(normalizePantryEntries(readStored<unknown>('lievia.dispensa.test.v1', []))).toEqual(edited)
    expect(addToPantry(edited, 'custom-old-1')).toBe(edited)
    expect(removeFromPantry(edited, 'custom-old-1')).toEqual([])
  })

  it('segnala scorte insufficienti senza alterare ricetta o quantità', () => {
    const entries = [{ flourId: 'official-1', quantityGrams: 400, notes: '', updatedAt: '2026-01-01T00:00:00.000Z' }]
    const requirements = [{ flourId: 'official-1', quantityGrams: 500 }]
    expect(getStockWarnings(entries, requirements)).toEqual([{ flourId: 'official-1', requiredGrams: 500, availableGrams: 400, reason: 'insufficient' }])
    const result = deductPantryStock(entries, [{ flourId: 'official-1', percentage: 100 }], 500)
    expect(result.insufficientIds).toEqual(['official-1'])
    expect(result.entries).toBe(entries)
  })

  it('distingue farine non registrate, quantità sconosciute e scorte sufficienti', () => {
    const entries = [
      { flourId: 'unknown-stock', quantityGrams: null, notes: '', updatedAt: '2026-01-01T00:00:00.000Z' },
      { flourId: 'enough-stock', quantityGrams: 1000, notes: '', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]
    expect(getStockWarnings(entries, [
      { flourId: 'not-tracked', quantityGrams: 200 },
      { flourId: 'unknown-stock', quantityGrams: 300 },
      { flourId: 'enough-stock', quantityGrams: 250 },
    ])).toEqual([
      { flourId: 'not-tracked', requiredGrams: 200, availableGrams: null, reason: 'not-in-pantry' },
      { flourId: 'unknown-stock', requiredGrams: 300, availableGrams: null, reason: 'quantity-unknown' },
    ])
  })

  it('deduce solo dopo richiesta esplicita del chiamante e aggiorna tutti i lotti noti insieme', () => {
    const entries = [
      { flourId: 'a', quantityGrams: 1000, notes: '', updatedAt: '2026-01-01T00:00:00.000Z' },
      { flourId: 'b', quantityGrams: 500, notes: '', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]
    const result = deductPantryStock(entries, [{ flourId: 'a', percentage: 60 }, { flourId: 'b', percentage: 40 }], 500, '2026-04-01T00:00:00.000Z')
    expect(result.entries.map(({ quantityGrams }) => quantityGrams)).toEqual([700, 300])
    expect(result.unavailableIds).toEqual([])
    expect(result.insufficientIds).toEqual([])
  })

  it('somma farine duplicate nella miscela e ignora le righe a zero', () => {
    const entries = [{ flourId: 'a', quantityGrams: 1000, notes: '', updatedAt: '2026-01-01T00:00:00.000Z' }]
    const blend = [
      { flourId: 'a', percentage: 30 },
      { flourId: 'a', percentage: 50 },
      { flourId: 'not-used', percentage: 0 },
    ]
    const result = deductPantryStock(entries, blend, 500, '2026-04-01T00:00:00.000Z')
    expect(result.entries[0].quantityGrams).toBe(600)
    expect(result.unavailableIds).toEqual([])
    expect(getStockWarnings(entries, [
      { flourId: 'not-used', quantityGrams: 0 },
      { flourId: 'a', quantityGrams: 150 },
      { flourId: 'a', quantityGrams: 250 },
    ])).toEqual([])
  })

  it('non scala quantità sconosciute o miscele che includono farine non presenti in dispensa', () => {
    const entries = [{ flourId: 'a', quantityGrams: null, notes: '', updatedAt: '2026-01-01T00:00:00.000Z' }]
    const result = deductPantryStock(entries, [{ flourId: 'a', percentage: 50 }, { flourId: 'custom', percentage: 50 }], 400)
    expect(result.unavailableIds).toEqual(['a', 'custom'])
    expect(result.entries).toBe(entries)
  })
})