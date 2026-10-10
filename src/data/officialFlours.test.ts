import { describe, expect, it } from 'vitest'
import catalogueData from './lievia_farine_verificate.json'
import additionalCatalogueData from './lievia_farine_aggiuntive_2026-10-10.json'
import { DEMO_FLOURS } from './defaults'
import { ARCHIVED_OFFICIAL_FLOURS, mergeFlourCatalog, mergeOfficialFlourCatalogues, normalizeCustomFlours, normalizeOfficialFlourCatalogue, OFFICIAL_CATALOGUE_RECORDS, OFFICIAL_FLOURS } from './officialFlours'
import { readStored, writeStored } from '../lib/storage'
import type { Flour } from '../models'

describe('catalogo commerciale verificato', () => {
  it('carica tutti i record con ID stabili e univoci', () => {
    expect(OFFICIAL_FLOURS).toHaveLength(64)
    expect(ARCHIVED_OFFICIAL_FLOURS).toHaveLength(1)
    expect(OFFICIAL_CATALOGUE_RECORDS).toHaveLength(65)
    expect(new Set(OFFICIAL_CATALOGUE_RECORDS.map(({ id }) => id)).size).toBe(65)
    expect(OFFICIAL_FLOURS[0].id).toBe('official:official-001')
    const manufacturerCounts = OFFICIAL_FLOURS.reduce<Record<string, number>>((counts, flour) => {
      counts[flour.brand] = (counts[flour.brand] ?? 0) + 1
      return counts
    }, {})
    expect(manufacturerCounts).toEqual({
      'Le 5 Stagioni': 4,
      'Molino Dallagiovanna': 13,
      'Molino Grassi': 12,
      'Molino Pasini': 5,
      'Molino Spadoni': 4,
      'Molino Vigevano': 10,
      'Mulino Caputo': 7,
      Polselli: 9,
    })
  })

  it('preserva gli intervalli e i null originali separando i midpoint legacy', () => {
    const pizzeria = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-001')
    expect(pizzeria?.officialSource?.wMin).toBe(260)
    expect(pizzeria?.officialSource?.wMax).toBe(280)
    expect(pizzeria?.strengthW).toBe(270)
    expect(pizzeria?.officialSource?.plMin).toBe(0.5)
    expect(pizzeria?.officialSource?.plMax).toBe(0.6)
    expect(pizzeria?.plRatio).toBeCloseTo(0.55)
    expect(pizzeria?.officialSource?.waterAbsorptionPercent).toBeNull()

    const missingProtein = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-008')
    expect(missingProtein?.proteinPct).toBeUndefined()
    expect(missingProtein?.officialSource?.proteinPercent).toBeNull()
    const missingType = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-029')
    expect(missingType?.officialSource?.flourType).toBeNull()
    expect(missingType?.flourType).toBe('Non dichiarato')
  })

  it('rifiuta ID duplicati e schede commerciali malformate', () => {
    const original = JSON.stringify(additionalCatalogueData)
    const duplicated = { ...catalogueData, flours: [catalogueData.flours[0], catalogueData.flours[0]] }
    expect(() => normalizeOfficialFlourCatalogue(duplicated)).toThrow(/ID duplicato/)
    expect(() => normalizeOfficialFlourCatalogue({ schemaVersion: '1', flours: [{}] })).toThrow(/scheda/)
    normalizeOfficialFlourCatalogue(additionalCatalogueData)
    expect(JSON.stringify(additionalCatalogueData)).toBe(original)
  })

  it('normalizza range annidati, data di accesso, note nulle e assorbimento farinografico separato', () => {
    const product = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-molino-grassi-pizza-e-focaccia-00')
    expect(product?.officialSource?.wMin).toBe(290)
    expect(product?.officialSource?.wMax).toBe(290)
    expect(product?.officialSource?.plMin).toBe(0.5)
    expect(product?.officialSource?.plMax).toBe(0.5)
    expect(product?.officialSource?.proteinPercent).toBeNull()
    expect(product?.officialSource?.farinographAbsorptionPercent).toBe(56)
    expect(product?.officialSource?.waterAbsorptionPercent).toBeNull()
    expect(product?.officialSource?.source.accessed).toBe('2026-10-10')
    expect(product?.officialSource?.source.checkedOn).toBeUndefined()
    expect(product?.officialSource?.originalRecord.source).toEqual({ type: 'manufacturer_official', url: 'https://www.molinograssi.it/product/farina-00-pizza-e-focaccia/', accessed: '2026-10-10' })
    expect(product?.officialSource?.originalRecord.notes).toBeNull()
    expect(product?.hydrationNotes).toBe('')

    const unavailableRanges = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-molino-vigevano-pizza-in-teglia')
    expect(unavailableRanges?.officialSource?.wMin).toBe(350)
    expect(unavailableRanges?.officialSource?.wMax).toBe(350)
    expect(unavailableRanges?.officialSource?.plMin).toBeNull()
    expect(unavailableRanges?.officialSource?.plMax).toBeNull()
  })

  it('classifica farine, miscele commerciali e preparati con ingredienti aggiunti', () => {
    expect(OFFICIAL_FLOURS.find(({ name }) => name === '00 Slow H24')?.productKind).toBe('flour')
    expect(OFFICIAL_FLOURS.find(({ name }) => name === 'Napoletana Midi')?.productKind).toBe('commercial-blend')
    expect(OFFICIAL_FLOURS.find(({ name }) => name === 'Moreschina')?.productKind).toBe('commercial-blend')
    expect(OFFICIAL_FLOURS.find(({ name }) => name === 'Preparato Gran Pizza alla Napoletana')?.productKind).toBe('prepared-mix')
  })

  it('mantiene le specifiche storiche nell’archivio, senza confonderle con il prodotto corrente', () => {
    const current = OFFICIAL_FLOURS.find(({ brand, name, officialSource }) => brand === 'Le 5 Stagioni' && name === 'Superiore' && !officialSource?.isArchived)
    const historical = ARCHIVED_OFFICIAL_FLOURS.find(({ brand }) => brand === 'Le 5 Stagioni')
    expect(current?.officialSource?.wMin).toBeNull()
    expect(historical?.name).toContain('scheda storica 2018')
    expect(historical?.officialSource?.wMin).toBe(320)
    expect(historical?.officialSource?.productIdentity).toBe(current?.officialSource?.productIdentity)
  })

  it('deduplica prodotti correnti omonimi anche quando hanno ID diversi', () => {
    const duplicate = {
      schemaVersion: 1,
      flours: [{ ...additionalCatalogueData.flours[0], id: 'duplicate-product-id' }],
    }
    const merged = mergeOfficialFlourCatalogues(duplicate, additionalCatalogueData)
    expect(merged.filter(({ brand, name }) => brand === 'Molino Grassi' && name === 'Pizza e Focaccia 00')).toHaveLength(1)
  })

  it('unisce seed e farine utente senza duplicati e dà precedenza ai record locali', () => {
    const custom: Flour = {
      id: OFFICIAL_FLOURS[0].id,
      brand: 'Farina personale',
      name: 'Profilo locale',
      flourType: '0',
      hydrationNotes: '',
      isDemo: false,
    }
    const catalog = mergeFlourCatalog([custom])
    expect(new Set(catalog.map(({ id }) => id)).size).toBe(catalog.length)
    expect(catalog.find(({ id }) => id === custom.id)).toEqual(custom)
    expect(catalog).toHaveLength(DEMO_FLOURS.length + OFFICIAL_FLOURS.length)
  })

  it('migra i profili locali preesistenti senza eliminare o duplicare le farine utente', () => {
    const existing: Flour = {
      id: 'custom-old-1', brand: 'Molino locale', name: 'Tipo 1', flourType: '1',
      strengthW: 250, hydrationNotes: 'Nota conservata', isDemo: false,
    }
    const migrated = normalizeCustomFlours([existing, existing, OFFICIAL_FLOURS[0], { id: 'broken' }])
    expect(migrated).toEqual([existing])
  })

  it('persiste i profili personalizzati separatamente dai seed commerciali', () => {
    const custom: Flour = {
      id: 'custom-persisted', brand: 'Molino locale', name: 'Tipo 1', flourType: '1',
      strengthW: 250, hydrationNotes: 'Prova locale', isDemo: false,
    }
    writeStored('lievia.test.flours', [custom])
    const restored = normalizeCustomFlours(readStored<unknown>('lievia.test.flours', []))
    expect(restored).toEqual([custom])
    expect(mergeFlourCatalog(restored).find(({ id }) => id === custom.id)).toEqual(custom)
    window.localStorage.removeItem('lievia.test.flours')
  })
})