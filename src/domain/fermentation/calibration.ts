export interface CalibrationRecord {
  version: 1
  id: string
  modelId: string
  modelVersion: string
  recordedAt: string
  sourceReferences: string[]
  sampleCount: number
  coefficients: Array<{ name: string; value: number; unit: string; sourceReference: string }>
  reviewed: boolean
  notes?: string
}

export function isCalibrationRecord(value: unknown): value is CalibrationRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<CalibrationRecord>
  return record.version === 1 && typeof record.id === 'string' && typeof record.modelId === 'string' &&
    typeof record.modelVersion === 'string' && typeof record.recordedAt === 'string' &&
    Number.isFinite(Date.parse(record.recordedAt)) && Array.isArray(record.sourceReferences) &&
    record.sourceReferences.every((source) => typeof source === 'string') && Array.isArray(record.coefficients) &&
    record.coefficients.every((coefficient) => typeof coefficient === 'object' && coefficient !== null &&
      typeof coefficient.name === 'string' && typeof coefficient.value === 'number' && Number.isFinite(coefficient.value) &&
      typeof coefficient.unit === 'string' && typeof coefficient.sourceReference === 'string') &&
    Number.isInteger(record.sampleCount) && (record.sampleCount ?? 0) >= 0 && typeof record.reviewed === 'boolean'
}

export function normalizeCalibrationRecords(value: unknown): CalibrationRecord[] {
  return Array.isArray(value) ? value.filter(isCalibrationRecord) : []
}