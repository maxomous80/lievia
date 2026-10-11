import { createDefaultDraft } from '../../data/defaults'
import { OFFICIAL_FLOURS } from '../../data/officialFlours'
import { createDefaultFermentationConfig } from '../fermentation/schedule'
import { createRecipeConfiguration } from '../lab/scenarios'
import { getBenchmarkBaselineFlour, getBenchmarkTargetFlourIds } from './benchmarkDataset'
import { DeterministicItalianInterpreter } from './deterministicItalianInterpreter'
import { createNaturalLanguageBenchmarkDataset, type NaturalLanguageBenchmarkCase } from './benchmarkDataset'
import type { NaturalLanguageContext, NaturalLanguageInterpretation } from './types'

const FIXED_NOW = new Date('2026-10-24T10:00:00.000Z')
const TRACKED_FIELDS = [
  'style', 'ballCount', 'ballWeight', 'totalDoughWeight', 'useTotalWeight', 'hydrationPct', 'saltPct', 'oilPct', 'yeastPct', 'yeastType',
  'flourBlend', 'fermentation.strategy', 'fermentation.totalDurationMinutes', 'fermentation.bakingAt',
  'fermentation.ambientTemperatureC', 'fermentation.refrigeratorTemperatureC', 'fermentation.measuredDoughTemperatureC', 'fermentation.availability',
]

export interface NaturalLanguageBenchmarkMetrics {
  datasetSize: number
  exactPatchMatches: number
  exactPatchAccuracy: number
  fieldPrecision: number
  fieldRecall: number
  fieldF1: number
  invalidPatchRate: number
  invalidCaseDetectionRecall: number
  expectedAmbiguityCases: number
  missedAmbiguityCount: number
  missedAmbiguityRate: number
  ambiguousCasesWithApplicableProposal: number
  expectedUnsupportedCases: number
  unsupportedAbstentionRecall: number
  latencyMs: { median: number; p95: number; min: number; max: number }
  categories: Record<string, { count: number; exactPatchMatches: number; accuracy: number }>
  failures: Array<{ id: string; category: string; prompt: string; expected: unknown; actual: unknown; ambiguities: string[]; validationErrors: string[]; unsupported: boolean; hasProposal: boolean; errors: string[] }>
}

export interface NaturalLanguageBenchmarkReport {
  generatedAt: string
  fixedClock: string
  timeZone: string
  datasetVersion: '4b1-manual-v1' | '4b2-heldout-v1' | '4b2-heldout-v2'
  metrics: NaturalLanguageBenchmarkMetrics
}

export function createBenchmarkContext(): NaturalLanguageContext {
  const fermentation = createDefaultFermentationConfig(FIXED_NOW)
  const baselineFlour = getBenchmarkBaselineFlour(OFFICIAL_FLOURS, getBenchmarkTargetFlourIds(OFFICIAL_FLOURS))
  const draft = createDefaultDraft('benchmark-base')
  return {
    currentConfiguration: createRecipeConfiguration({
      ...draft,
      name: 'Benchmark',
      flourBlend: baselineFlour ? [{ flourId: baselineFlour.id, percentage: 100 }] : draft.flourBlend,
      fermentation,
    }, fermentation),
    flours: OFFICIAL_FLOURS,
    pantryEntries: [],
    now: new Date(FIXED_NOW),
    timeZone: 'Europe/Rome',
  }
}

export function runNaturalLanguageBenchmark(
  cases: NaturalLanguageBenchmarkCase[] = createNaturalLanguageBenchmarkDataset(OFFICIAL_FLOURS),
  clock: () => number = () => performance.now(),
  datasetVersion: NaturalLanguageBenchmarkReport['datasetVersion'] = '4b1-manual-v1',
): NaturalLanguageBenchmarkReport {
  const interpreter = new DeterministicItalianInterpreter()
  const context = createBenchmarkContext()
  const latency: number[] = []
  const categoryCounts = new Map<string, { count: number; exact: number }>()
  const failures: NaturalLanguageBenchmarkMetrics['failures'] = []
  let exact = 0
  let truePositive = 0
  let falsePositive = 0
  let falseNegative = 0
  let invalid = 0
  let expectedInvalid = 0
  let detectedInvalid = 0
  let expectedAmbiguity = 0
  let missedAmbiguity = 0
  let ambiguousCasesWithApplicableProposal = 0
  let expectedUnsupported = 0
  let abstainedUnsupported = 0

  for (const testCase of cases) {
    const start = clock()
    const result = interpreter.interpret(testCase.prompt, context)
    latency.push(Math.max(0, clock() - start))
    const expectedBakingAt = typeof testCase.expectedPatch.fermentation?.bakingAt === 'string'
    const actual = normalizePatch(result.patch, expectedBakingAt)
    const expected = normalizePatch(testCase.expectedPatch)
    const patchMatches = sameValue(actual, expected)
    if (patchMatches) exact += 1
    const category = categoryCounts.get(testCase.category) ?? { count: 0, exact: 0 }
    category.count += 1
    if (patchMatches) category.exact += 1
    categoryCounts.set(testCase.category, category)

    const actualFields = flatten(actual)
    const expectedFields = flatten(expected)
    for (const field of TRACKED_FIELDS) {
      const actualHas = Object.hasOwn(actualFields, field)
      const expectedHas = Object.hasOwn(expectedFields, field)
      if (actualHas && expectedHas && sameValue(actualFields[field], expectedFields[field])) truePositive += 1
      else {
        if (actualHas) falsePositive += 1
        if (expectedHas) falseNegative += 1
      }
    }

    const isInvalid = result.validationErrors.length > 0
    if (isInvalid) invalid += 1
    if (testCase.expectInvalid) {
      expectedInvalid += 1
      if (isInvalid) detectedInvalid += 1
    }
    if (testCase.expectAmbiguity) {
      expectedAmbiguity += 1
      if (!result.ambiguities.length) missedAmbiguity += 1
      if (result.ambiguities.length && result.proposedConfiguration !== null) ambiguousCasesWithApplicableProposal += 1
    }
    if (testCase.expectUnsupported) {
      expectedUnsupported += 1
      if (result.intent === 'unsupported' || (result.proposedConfiguration === null && result.unsupportedRequests.length > 0)) abstainedUnsupported += 1
    }

    const errors = [
      ...(testCase.expectAmbiguity && !result.ambiguities.length ? ['expected clarification was not reported'] : []),
      ...(testCase.expectAmbiguity && result.ambiguities.length && result.proposedConfiguration !== null ? ['ambiguous request produced an applicable proposal'] : []),
      ...(testCase.expectUnsupported && result.intent !== 'unsupported' && !(result.proposedConfiguration === null && result.unsupportedRequests.length > 0) ? ['unsupported request was not classified'] : []),
      ...(testCase.expectInvalid && !isInvalid ? ['invalid value was not rejected'] : []),
      ...(testCase.expectedPantryOnly !== undefined && result.usePantryOnly !== testCase.expectedPantryOnly ? ['pantry constraint mismatch'] : []),
      ...(!patchMatches ? ['patch differs from manually authored expectation'] : []),
    ]
    if (errors.length) failures.push({
      id: testCase.id,
      category: testCase.category,
      prompt: testCase.prompt,
      expected,
      actual,
      ambiguities: result.ambiguities.map(({ field }) => field),
      validationErrors: result.validationErrors.map(({ field }) => field),
      unsupported: result.intent === 'unsupported' || result.unsupportedRequests.length > 0,
      hasProposal: result.proposedConfiguration !== null,
      errors,
    })
  }

  const precision = ratio(truePositive, truePositive + falsePositive)
  const recall = ratio(truePositive, truePositive + falseNegative)
  const sortedLatency = [...latency].sort((left, right) => left - right)
  const metrics: NaturalLanguageBenchmarkMetrics = {
    datasetSize: cases.length,
    exactPatchMatches: exact,
    exactPatchAccuracy: ratio(exact, cases.length),
    fieldPrecision: precision,
    fieldRecall: recall,
    fieldF1: ratio(2 * precision * recall, precision + recall),
    invalidPatchRate: ratio(invalid, cases.length),
    invalidCaseDetectionRecall: ratio(detectedInvalid, expectedInvalid),
    expectedAmbiguityCases: expectedAmbiguity,
    missedAmbiguityCount: missedAmbiguity,
    missedAmbiguityRate: ratio(missedAmbiguity, expectedAmbiguity),
    ambiguousCasesWithApplicableProposal,
    expectedUnsupportedCases: expectedUnsupported,
    unsupportedAbstentionRecall: ratio(abstainedUnsupported, expectedUnsupported),
    latencyMs: { median: percentile(sortedLatency, 0.5), p95: percentile(sortedLatency, 0.95), min: sortedLatency[0] ?? 0, max: sortedLatency.at(-1) ?? 0 },
    categories: Object.fromEntries([...categoryCounts].map(([name, value]) => [name, { count: value.count, exactPatchMatches: value.exact, accuracy: ratio(value.exact, value.count) }])),
    failures,
  }

  return {
    generatedAt: new Date().toISOString(),
    fixedClock: FIXED_NOW.toISOString(),
    timeZone: 'Europe/Rome',
    datasetVersion,
    metrics,
  }
}

export function summarizeInterpretation(interpretation: NaturalLanguageInterpretation): Record<string, unknown> {
  return {
    intent: interpretation.intent,
    patch: normalizePatch(interpretation.patch),
    ambiguities: interpretation.ambiguities.map(({ field }) => field),
    clarificationQuestions: interpretation.ambiguities.map(({ field, question }) => ({ field, question })),
    validationErrors: interpretation.validationErrors.map(({ field }) => field),
    unsupportedRequests: interpretation.unsupportedRequests.length,
    usePantryOnly: interpretation.usePantryOnly,
  }
}

function normalizePatch(value: unknown, includeBakingAt = true): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const topLevelKeys = ['style', 'ballCount', 'ballWeight', 'totalDoughWeight', 'useTotalWeight', 'hydrationPct', 'saltPct', 'oilPct', 'yeastPct', 'yeastType', 'flourBlend', 'fermentation']
  const normalized = Object.fromEntries(Object.entries(source).filter(([key]) => topLevelKeys.includes(key)))
  if (normalized.totalDoughWeight === undefined && normalized.useTotalWeight === false) delete normalized.useTotalWeight
  if (typeof normalized.yeastPct === 'number') normalized.yeastPct = Number(normalized.yeastPct.toFixed(3))
  if (Array.isArray(normalized.flourBlend)) normalized.flourBlend = [...normalized.flourBlend].sort((left, right) => {
    const leftId = typeof left === 'object' && left !== null && 'flourId' in left ? String(left.flourId) : ''
    const rightId = typeof right === 'object' && right !== null && 'flourId' in right ? String(right.flourId) : ''
    return leftId.localeCompare(rightId)
  })
  if (typeof normalized.fermentation === 'object' && normalized.fermentation !== null && !Array.isArray(normalized.fermentation)) {
    const fermentationKeys = ['strategy', 'totalDurationMinutes', 'ambientTemperatureC', 'refrigeratorTemperatureC', 'measuredDoughTemperatureC', 'availability', ...(includeBakingAt ? ['bakingAt'] : [])]
    normalized.fermentation = Object.fromEntries(Object.entries(normalized.fermentation).filter(([key]) => fermentationKeys.includes(key)))
    if (!Object.keys(normalized.fermentation as Record<string, unknown>).length) delete normalized.fermentation
  }
  return normalized
}

function flatten(value: Record<string, unknown>, prefix = '', output: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) flatten(entry as Record<string, unknown>, path, output)
    else output[path] = entry
  }
  return output
}

function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-8
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((entry, index) => sameValue(entry, right[index]))
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord).sort()
    const rightKeys = Object.keys(rightRecord).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key]))
  }
  return left === right
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  return Number(values[Math.ceil(fraction * values.length) - 1].toFixed(3))
}