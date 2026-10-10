import catalogueData from './lievia_farine_verificate.json'
import additionalCatalogueData from './lievia_farine_aggiuntive_2026-10-10.json'
import { DEMO_FLOURS } from './defaults'
import type { Flour, FlourProductKind, OfficialFlourSourceRecord } from '../models'

export function normalizeOfficialFlourCatalogue(value: unknown): Flour[] {
  if (!isRecord(value) || !Array.isArray(value.flours)) {
    throw new TypeError('Il catalogo ufficiale delle farine non è valido.')
  }
  const schemaVersion = value.schemaVersion
  if (typeof schemaVersion !== 'string' && typeof schemaVersion !== 'number') {
    throw new TypeError('Il catalogo ufficiale delle farine non è valido.')
  }

  const seenIds = new Set<string>()
  return value.flours.map((candidate) => {
    const record = normalizeOfficialFlourRecord(candidate, schemaVersion)
    if (!record) throw new TypeError('Una scheda del catalogo ufficiale non è valida.')
    if (seenIds.has(record.id)) throw new TypeError(`ID duplicato nel catalogo ufficiale: ${record.id}`)
    seenIds.add(record.id)

    const wMidpoint = midpoint(record.wMin, record.wMax)
    const plMidpoint = midpoint(record.plMin, record.plMax)
    return {
      id: `official:${record.id}`,
      brand: record.brand,
      name: record.name,
      flourType: record.flourType ?? 'Non dichiarato',
      strengthW: wMidpoint,
      plRatio: plMidpoint,
      proteinPct: record.proteinPercent ?? undefined,
      hydrationNotes: record.notes ?? '',
      technicalDataSource: record.source.url,
      isDemo: false,
      productKind: record.productKind,
      officialSource: record,
    }
  })
}

export function mergeOfficialFlourCatalogues(...catalogues: unknown[]): Flour[] {
  const flours = catalogues.flatMap(normalizeOfficialFlourCatalogue)
  const seenIds = new Set<string>()
  const seenProducts = new Set<string>()
  return flours.filter((flour) => {
    const source = flour.officialSource!
    if (seenIds.has(flour.id)) throw new TypeError(`ID commerciale duplicato: ${source.id}`)
    seenIds.add(flour.id)
    const productKey = `${normalizeProductName(flour.brand)}|${source.productIdentity}|${source.isArchived ? 'historical' : 'current'}`
    if (seenProducts.has(productKey)) return false
    seenProducts.add(productKey)
    return true
  })
}

export function normalizeCustomFlours(value: unknown): Flour[] {
  if (!Array.isArray(value)) return []
  const seenIds = new Set<string>()
  return value.filter((candidate): candidate is Flour => {
    if (!isCustomFlour(candidate) || seenIds.has(candidate.id)) return false
    seenIds.add(candidate.id)
    return true
  })
}

export function mergeFlourCatalog(customFlours: Flour[], officialFlours = OFFICIAL_FLOURS): Flour[] {
  const customIds = new Set(customFlours.map(({ id }) => id))
  const uniqueSeedFlours = [...DEMO_FLOURS, ...officialFlours].filter((flour) => !customIds.has(flour.id))
  const seenIds = new Set(customIds)
  return [
    ...uniqueSeedFlours.filter((flour) => {
      if (seenIds.has(flour.id)) return false
      seenIds.add(flour.id)
      return true
    }),
    ...customFlours,
  ]
}

export const OFFICIAL_CATALOGUE_RECORDS = mergeOfficialFlourCatalogues(catalogueData, additionalCatalogueData)
export const OFFICIAL_FLOURS = OFFICIAL_CATALOGUE_RECORDS.filter(({ officialSource }) => !officialSource?.isArchived)
export const ARCHIVED_OFFICIAL_FLOURS = OFFICIAL_CATALOGUE_RECORDS.filter(({ officialSource }) => officialSource?.isArchived)

function midpoint(min: number | null, max: number | null): number | undefined {
  return min === null || max === null ? undefined : (min + max) / 2
}

function isCustomFlour(value: unknown): value is Flour {
  if (!isRecord(value)) return false
  return value.isDemo === false && value.officialSource === undefined &&
    typeof value.id === 'string' && value.id.length > 0 && typeof value.brand === 'string' &&
    typeof value.name === 'string' && typeof value.flourType === 'string' &&
    typeof value.hydrationNotes === 'string' &&
    ['strengthW', 'plRatio', 'proteinPct'].every((key) => value[key] === undefined ||
      typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) &&
    (value.technicalDataSource === undefined || typeof value.technicalDataSource === 'string')
}

function normalizeOfficialFlourRecord(value: unknown, schemaVersion: string | number): OfficialFlourSourceRecord | undefined {
  if (!isRecord(value)) return undefined
  const flatShape = ['wMin', 'wMax', 'plMin', 'plMax', 'waterAbsorptionPercent'].some((key) => Object.hasOwn(value, key))
  const w = normalizeRange(flatShape ? { min: value.wMin ?? null, max: value.wMax ?? null } : value.w)
  const pl = normalizeRange(flatShape ? { min: value.plMin ?? null, max: value.plMax ?? null } : value.pl)
  const source = value.source
  const notes = value.notes === undefined ? null : value.notes
  const validNumberOrNull = (entry: unknown) => entry === null || typeof entry === 'number' && Number.isFinite(entry) && entry >= 0
  if (typeof value.id !== 'string' || !value.id || typeof value.brand !== 'string' || typeof value.name !== 'string' ||
    (typeof value.flourType !== 'string' && value.flourType !== null) || !w || !pl ||
    !validNumberOrNull(value.proteinPercent) ||
    (value.waterAbsorptionPercent !== undefined && !validNumberOrNull(value.waterAbsorptionPercent)) ||
    (value.farinographAbsorptionPercent !== undefined && !validNumberOrNull(value.farinographAbsorptionPercent)) ||
    !isRecord(source) || typeof source.type !== 'string' || typeof source.url !== 'string' ||
    typeof (source.checkedOn ?? source.accessed) !== 'string' ||
    (notes !== null && typeof notes !== 'string') ||
    (value.qualityFlags !== undefined && (!Array.isArray(value.qualityFlags) || !value.qualityFlags.every((flag) => typeof flag === 'string'))) ||
    (value.verifiedFields !== undefined && (!Array.isArray(value.verifiedFields) || !value.verifiedFields.every((field) => typeof field === 'string'))) ||
    (value.imageUrl !== undefined && typeof value.imageUrl !== 'string')) return undefined

  const sourceRecord = {
    type: source.type,
    url: source.url,
    ...(typeof source.checkedOn === 'string' ? { checkedOn: source.checkedOn } : {}),
    ...(typeof source.accessed === 'string' ? { accessed: source.accessed } : {}),
  }
  const provisional = {
    id: value.id,
    brand: value.brand,
    name: value.name,
    flourType: value.flourType as string | null,
    wMin: w.min,
    wMax: w.max,
    plMin: pl.min,
    plMax: pl.max,
    proteinPercent: value.proteinPercent as number | null,
    farinographAbsorptionPercent: (value.farinographAbsorptionPercent ?? null) as number | null,
    waterAbsorptionPercent: (value.waterAbsorptionPercent ?? null) as number | null,
    source: sourceRecord,
    notes,
    qualityFlags: value.qualityFlags ?? [],
    verifiedFields: value.verifiedFields ?? [],
    originalRecord: { ...value },
    catalogueSchemaVersion: schemaVersion,
    imageUrl: value.imageUrl,
  }
  const historical = isHistoricalRecord(provisional.name, provisional.notes)
  const productKind = classifyProduct(provisional)
  const productIdentity = normalizeProductName(provisional.name.replace(/\s*[-–—]?\s*scheda storica\s+\d{4}\s*/i, ''))
  return { ...provisional, productKind, isArchived: historical, productIdentity }
}

function normalizeRange(value: unknown): { min: number | null; max: number | null } | undefined {
  if (value === null) return { min: null, max: null }
  if (!isRecord(value) || (value.min !== null && typeof value.min !== 'number') ||
    (value.max !== null && typeof value.max !== 'number')) return undefined
  if ([value.min, value.max].some((entry) => typeof entry === 'number' && (!Number.isFinite(entry) || entry < 0))) return undefined
  if (typeof value.min === 'number' && typeof value.max === 'number' && value.min > value.max) return undefined
  return { min: value.min as number | null, max: value.max as number | null }
}

function isHistoricalRecord(name: string, notes: string | null) {
  return /scheda storica|storica\s+\d{4}/i.test(`${name} ${notes ?? ''}`)
}

function classifyProduct(record: Pick<OfficialFlourSourceRecord, 'name' | 'notes' | 'flourType'>): FlourProductKind {
  const searchable = `${record.name} ${record.notes ?? ''}`
  if (/\bpreparato\b|contiene\s+(?:pasta madre|lievito|malto)/i.test(searchable)) return 'prepared-mix'
  if (record.flourType?.toLocaleLowerCase('it') === 'miscela' || /miscela\s+multicereali/i.test(searchable)) return 'commercial-blend'
  return 'flour'
}

function normalizeProductName(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it')
    .replace(/scheda storica\s+\d{4}/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}