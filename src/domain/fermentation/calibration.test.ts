import { describe, expect, it } from 'vitest'
import { isCalibrationRecord, normalizeCalibrationRecords, type CalibrationRecord } from './calibration'

const record: CalibrationRecord = {
  version: 1,
  id: 'calibrazione-1',
  modelId: 'modello-futuro',
  modelVersion: '1.0.0',
  recordedAt: '2026-10-10T12:00:00.000Z',
  sourceReferences: ['https://example.invalid/protocollo'],
  sampleCount: 0,
  coefficients: [],
  reviewed: false,
}

describe('record di calibrazione', () => {
  it('accetta lo schema versionato e scarta riferimenti malformati', () => {
    expect(isCalibrationRecord(record)).toBe(true)
    expect(isCalibrationRecord({ ...record, sampleCount: -1 })).toBe(false)
    expect(isCalibrationRecord({ ...record, coefficients: [{ name: 'k', value: Number.NaN }] })).toBe(false)
    expect(normalizeCalibrationRecords([record, { ...record, id: 'errore', reviewed: 'no' }])).toEqual([record])
  })
})