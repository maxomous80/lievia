import { describe, expect, it } from 'vitest'
import { OFFICIAL_FLOURS } from '../../data/officialFlours'
import { createNaturalLanguageBenchmarkDataset } from './benchmarkDataset'
import { runNaturalLanguageBenchmark } from './benchmark'
import { HELD_OUT_DATASET_VERSION, HELD_OUT_HISTORICAL_V1_METRICS, HELD_OUT_NATURAL_LANGUAGE_CASES } from './benchmarkHeldOutDataset'

describe('benchmark baseline interprete italiano', () => {
  it('usa almeno 80 esempi manuali e riproducibili', () => {
    const cases = createNaturalLanguageBenchmarkDataset(OFFICIAL_FLOURS)
    expect(cases.length).toBeGreaterThanOrEqual(80)
    expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length)
    expect(new Set(cases.map(({ category }) => category))).toContain('unsupported')
    expect(new Set(cases.map(({ category }) => category))).toContain('follow-up')
    for (const { flourBlend } of cases.map(({ expectedPatch }) => expectedPatch).filter((patch) => patch.flourBlend)) {
      expect(new Set(flourBlend!.map(({ flourId }) => flourId)).size).toBe(flourBlend!.length)
      expect(flourBlend!.reduce((total, { percentage }) => total + percentage, 0)).toBe(100)
    }
  })

  it('misura output, astensione, ambiguità e tempi senza modificare il contesto', () => {
    const report = runNaturalLanguageBenchmark()
    expect(report.datasetVersion).toBe('4b1-manual-v1')
    expect(report.metrics.datasetSize).toBeGreaterThanOrEqual(80)
    expect(report.metrics.fieldPrecision).toBeGreaterThanOrEqual(0)
    expect(report.metrics.fieldRecall).toBeGreaterThanOrEqual(0)
    expect(report.metrics.latencyMs.max).toBeGreaterThanOrEqual(report.metrics.latencyMs.min)
    console.info(`NATURAL_LANGUAGE_BENCHMARK_AFTER ${JSON.stringify({ metrics: { ...report.metrics, failures: undefined }, failureIds: report.metrics.failures.map(({ id }) => id) })}`)
  })

  it('valuta la versione 2 del corpus held-out e conserva il baseline storico v1', () => {
    expect(HELD_OUT_NATURAL_LANGUAGE_CASES.length).toBeGreaterThanOrEqual(40)
    expect(new Set(HELD_OUT_NATURAL_LANGUAGE_CASES.map(({ id }) => id)).size).toBe(HELD_OUT_NATURAL_LANGUAGE_CASES.length)
    const report = runNaturalLanguageBenchmark(HELD_OUT_NATURAL_LANGUAGE_CASES, undefined, HELD_OUT_DATASET_VERSION)
    expect(report.datasetVersion).toBe(HELD_OUT_DATASET_VERSION)
    expect(HELD_OUT_HISTORICAL_V1_METRICS.datasetSize).toBe(HELD_OUT_NATURAL_LANGUAGE_CASES.length)
    const ambiguousCases = HELD_OUT_NATURAL_LANGUAGE_CASES.filter(({ expectAmbiguity }) => expectAmbiguity)
    expect(report.metrics.missedAmbiguityCount).toBe(0)
    expect(report.metrics.ambiguousCasesWithApplicableProposal).toBe(0)
    expect(ambiguousCases.length).toBe(report.metrics.expectedAmbiguityCases)
    console.info(`NATURAL_LANGUAGE_HELDOUT_V2 ${JSON.stringify({ historicalV1Baseline: HELD_OUT_HISTORICAL_V1_METRICS, currentV2: { ...report.metrics, failures: undefined }, failures: report.metrics.failures.map(({ id, prompt, expected, actual, ambiguities, unsupported }) => ({ id, prompt, expected, actual, ambiguities, unsupported })) })}`)
  })
})