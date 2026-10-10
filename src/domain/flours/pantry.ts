import type { FlourBlendItem } from '../../models'

export interface PantryEntry {
  flourId: string
  quantityGrams: number | null
  notes: string
  updatedAt: string
}

export interface PantryStockResult {
  entries: PantryEntry[]
  unavailableIds: string[]
  insufficientIds: string[]
}

export interface PantryStockWarning {
  flourId: string
  requiredGrams: number
  availableGrams: number | null
  reason: 'not-in-pantry' | 'quantity-unknown' | 'insufficient'
}

export function normalizePantryEntries(value: unknown): PantryEntry[] {
  if (!Array.isArray(value)) return []
  const entries = new Map<string, PantryEntry>()
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.flourId !== 'string' || !candidate.flourId.trim() ||
      !(candidate.quantityGrams === null || typeof candidate.quantityGrams === 'number' &&
        Number.isFinite(candidate.quantityGrams) && candidate.quantityGrams >= 0) ||
      typeof candidate.notes !== 'string') continue
    const updatedAt = typeof candidate.updatedAt === 'string' && Number.isFinite(Date.parse(candidate.updatedAt))
      ? candidate.updatedAt
      : new Date(0).toISOString()
    const entry: PantryEntry = {
      flourId: candidate.flourId,
      quantityGrams: candidate.quantityGrams,
      notes: candidate.notes,
      updatedAt,
    }
    const previous = entries.get(entry.flourId)
    if (!previous || Date.parse(entry.updatedAt) >= Date.parse(previous.updatedAt)) entries.set(entry.flourId, entry)
  }
  return [...entries.values()]
}

export function addToPantry(entries: PantryEntry[], flourId: string, now = new Date().toISOString()): PantryEntry[] {
  if (entries.some((entry) => entry.flourId === flourId)) return entries
  return [...entries, { flourId, quantityGrams: null, notes: '', updatedAt: now }]
}

export function updatePantryEntry(entries: PantryEntry[], flourId: string, changes: Partial<Pick<PantryEntry, 'quantityGrams' | 'notes'>>, now = new Date().toISOString()): PantryEntry[] {
  if (changes.quantityGrams !== undefined && changes.quantityGrams !== null &&
    (!Number.isFinite(changes.quantityGrams) || changes.quantityGrams < 0)) return entries
  return entries.map((entry) => entry.flourId === flourId
    ? { ...entry, ...changes, updatedAt: now }
    : entry)
}

export function removeFromPantry(entries: PantryEntry[], flourId: string): PantryEntry[] {
  return entries.filter((entry) => entry.flourId !== flourId)
}

export function getStockWarnings(entries: PantryEntry[], requirements: Array<{ flourId: string; quantityGrams: number }>) {
  const byId = new Map(entries.map((entry) => [entry.flourId, entry]))
  return aggregateRequirements(requirements).flatMap<PantryStockWarning>((requirement) => {
    const entry = byId.get(requirement.flourId)
    if (!entry) return [{ flourId: requirement.flourId, requiredGrams: requirement.quantityGrams, availableGrams: null, reason: 'not-in-pantry' }]
    if (entry.quantityGrams === null) return [{ flourId: requirement.flourId, requiredGrams: requirement.quantityGrams, availableGrams: null, reason: 'quantity-unknown' }]
    return requirement.quantityGrams > entry.quantityGrams
      ? [{ flourId: requirement.flourId, requiredGrams: requirement.quantityGrams, availableGrams: entry.quantityGrams, reason: 'insufficient' }]
      : []
  })
}

export function deductPantryStock(entries: PantryEntry[], blend: FlourBlendItem[], flourWeightGrams: number, now = new Date().toISOString()): PantryStockResult {
  const requirements = aggregateRequirements(blend.filter(({ percentage }) => percentage > 0).map(({ flourId, percentage }) => ({
    flourId,
    quantityGrams: flourWeightGrams * percentage / 100,
  })))
  const byId = new Map(entries.map((entry) => [entry.flourId, entry]))
  const unavailableIds = requirements.filter(({ flourId }) => byId.get(flourId)?.quantityGrams == null).map(({ flourId }) => flourId)
  const insufficientIds = requirements.filter(({ flourId, quantityGrams }) => {
    const available = byId.get(flourId)?.quantityGrams
    return available !== null && available !== undefined && quantityGrams > available
  }).map(({ flourId }) => flourId)
  if (unavailableIds.length || insufficientIds.length) return { entries, unavailableIds, insufficientIds }
  const required = new Map(requirements.map(({ flourId, quantityGrams }) => [flourId, quantityGrams]))
  return {
    entries: entries.map((entry) => ({
      ...entry,
      quantityGrams: entry.quantityGrams === null ? null : Math.max(0, entry.quantityGrams - (required.get(entry.flourId) ?? 0)),
      updatedAt: required.has(entry.flourId) ? now : entry.updatedAt,
    })),
    unavailableIds: [],
    insufficientIds: [],
  }
}

function aggregateRequirements(requirements: Array<{ flourId: string; quantityGrams: number }>) {
  const totals = new Map<string, number>()
  for (const requirement of requirements) {
    if (!Number.isFinite(requirement.quantityGrams) || requirement.quantityGrams <= 0) continue
    totals.set(requirement.flourId, (totals.get(requirement.flourId) ?? 0) + requirement.quantityGrams)
  }
  return [...totals].map(([flourId, quantityGrams]) => ({ flourId, quantityGrams }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}