import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultDraft } from '../../data/defaults'
import { OFFICIAL_FLOURS } from '../../data/officialFlours'
import { createDefaultFermentationConfig } from '../fermentation/schedule'
import { updateTotalDuration } from '../fermentation/schedule'
import { normalizeLabWorkspace, createAlternativeScenario, createLabSession, patchScenario, prepareScenarioApplication, renameScenario, resetScenario, selectScenario } from './workspace'
import { calculateScenario, compareScenarios, createRecipeConfiguration, validateRecipePatch, type RecipeConfiguration } from './scenarios'
import { readStored, writeStored } from '../../lib/storage'
import { calculateTemperatureProfile } from '../fermentation/temperatureProfile'

const now = '2026-10-10T12:00:00.000Z'

function makeConfiguration(): RecipeConfiguration {
  const fermentation = createDefaultFermentationConfig(new Date(now))
  return createRecipeConfiguration({ ...createDefaultDraft('demo-00'), name: 'Impasto base', fermentation }, fermentation)
}

function makeSession() {
  return createLabSession({
    id: 'lab-session-1', baselineId: 'recipe:1', baselineName: 'Ricetta originale',
    baselineConfiguration: makeConfiguration(), sourceRecipeId: 'recipe-1', scenarioId: 'scenario-1', now,
  })
}

afterEach(() => window.localStorage.removeItem('lievia.test.lab.v1'))

describe('Lievia Lab · dominio scenari', () => {
  it('crea scenari senza mutare la configurazione baseline', () => {
    const baseline = makeConfiguration()
    const before = structuredClone(baseline)
    const session = createLabSession({ id: 'session', baselineId: 'recipe:1', baselineName: 'Base', baselineConfiguration: baseline, scenarioId: 's1', now })
    expect(session.scenarios[0].configuration).toEqual(before)
    expect(baseline).toEqual(before)
    expect(session.scenarios[0].configuration).not.toBe(baseline)
  })

  it('mantiene baseline e scenario immutati durante i confronti termici', () => {
    const baselineConfiguration = makeConfiguration()
    baselineConfiguration.fermentation.measuredDoughTemperatureC = 24
    const session = createLabSession({ id: 'session-termica', baselineId: 'base', baselineName: 'Base', baselineConfiguration, scenarioId: 'scenario-termico', now })
    const scenarioConfiguration = validateRecipePatch(session.scenarios[0].configuration, { fermentation: { ambientTemperatureC: 19 } })
    expect(scenarioConfiguration.ok).toBe(true)
    if (!scenarioConfiguration.ok) return
    const beforeBaseline = structuredClone(session.baselineConfiguration)
    const beforeScenario = structuredClone(scenarioConfiguration.configuration)
    calculateTemperatureProfile(session.baselineConfiguration.fermentation, { timeConstantMinutes: 100 })
    calculateTemperatureProfile(scenarioConfiguration.configuration.fermentation, { timeConstantMinutes: 100 })
    expect(session.baselineConfiguration).toEqual(beforeBaseline)
    expect(scenarioConfiguration.configuration).toEqual(beforeScenario)
  })

  it('valida patch parziali e rifiuta valori, campi e miscele non validi', () => {
    const baseline = makeConfiguration()
    const valid = validateRecipePatch(baseline, { hydrationPct: 70 })
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(valid.configuration.hydrationPct).toBe(70)
    expect(validateRecipePatch(baseline, { hydrationPct: Number.NaN }).issues[0].field).toBe('hydrationPct')
    expect(validateRecipePatch(baseline, { unknownMutation: true }).issues[0].message).toMatch(/non riconosciuto/)
    expect(validateRecipePatch(baseline, { flourBlend: [{ flourId: 'demo-00', percentage: 60 }] }).issues[0].message).toMatch(/100%/)
  })

  it('calcola differenze ingredienti esatte riusando il calcolatore esistente', () => {
    const baselineConfiguration = makeConfiguration()
    const patched = validateRecipePatch(baselineConfiguration, { hydrationPct: 75 })
    expect(patched.ok).toBe(true)
    if (!patched.ok) return
    const baseline = calculateScenario('base', 'Baseline', baselineConfiguration, [], [])
    const alternative = calculateScenario('alt', 'Idratazione 70%', patched.configuration, [], [])
    const comparison = compareScenarios(baseline, alternative)
    const water = comparison.ingredients.find(({ ingredient }) => ingredient === 'Acqua')!
    expect(water.classification).toBe('calcolo esatto')
    expect(water.difference).toBeGreaterThan(0)
    expect(alternative.dough?.waterWeight).toBe(alternative.dough!.flourWeight * 0.75)
  })

  it('mantiene visibile nel Lab uno scenario infeasible senza applicarlo come raccomandazione', () => {
    const base = makeConfiguration()
    const fermentation = updateTotalDuration(base.fermentation, 60)
    const result = calculateScenario('one-hour', 'Un’ora', { ...base, fermentation }, [], [])
    expect(result.schedule.feasible).toBe(false)
    expect(result.schedule.validation.status).toBe('Piano non fattibile')
    expect(result.schedule.conflicts.join(' ')).toContain('durata positiva')
    expect(result.schedule.current.bakingAt).toBe(base.fermentation.bakingAt)
    expect(result.dough?.totalDoughWeight).toBeGreaterThan(0)
  })

  it('confronta blend, campi mancanti e disponibilità senza dichiarare equivalenze', () => {
    const base = makeConfiguration()
    const official = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-008')!
    const session = createLabSession({ id: 's', baselineId: 'base', baselineName: 'Base', baselineConfiguration: base, scenarioId: 'alt', now })
    const changed = patchScenario(session, 'alt', { flourBlend: [{ flourId: official.id, percentage: 100 }] }, OFFICIAL_FLOURS, now)
    expect(changed.issues).toEqual([])
    const scenario = changed.session.scenarios[0]
    const result = calculateScenario(scenario.id, scenario.name, scenario.configuration, OFFICIAL_FLOURS, [])
    expect(result.missingFlourData[0].fields).toContain('proteine')
    expect(result.stockWarnings[0].reason).toBe('not-in-pantry')
    expect(compareScenarios(calculateScenario('base', 'Base', base, OFFICIAL_FLOURS, []), result).blendChanged).toBe(true)
  })

  it('somma le righe duplicate della stessa farina nella comparazione', () => {
    const base = makeConfiguration()
    const flourId = base.flourBlend[0].flourId
    const baselineConfiguration = createRecipeConfiguration({ ...base, flourBlend: [{ flourId, percentage: 100 }] }, base.fermentation)
    const alternativeConfiguration = createRecipeConfiguration({ ...base, flourBlend: [{ flourId, percentage: 40 }, { flourId, percentage: 60 }] }, base.fermentation)
    const baseline = calculateScenario('base', 'Base', baselineConfiguration, [], [])
    const alternative = calculateScenario('alt', 'Duplicata', alternativeConfiguration, [], [])
    const flour = compareScenarios(baseline, alternative).ingredients.find(({ ingredient }) => ingredient === `Farina · ${flourId}`)!
    expect(alternative.dough?.flourQuantities).toHaveLength(2)
    expect(flour.alternative).toBe(baseline.dough?.flourWeight)
    expect(flour.difference).toBe(0)
  })

  it('rispetta le fasi bloccate quando si sposta la finestra e rende espliciti i conflitti', () => {
    const base = makeConfiguration()
    const lockedPhases = base.fermentation.phases.map((phase) => phase.type === 'dividing' ? { ...phase, boundaryLocked: true } : phase)
    const lock = validateRecipePatch(base, { fermentation: { phases: lockedPhases } })
    expect(lock.ok).toBe(true)
    if (!lock.ok) return
    const moved = validateRecipePatch(lock.configuration, { fermentation: { bakingAt: '2026-10-12T20:30:00.000Z' } })
    expect(moved.ok).toBe(false)
    if (!moved.ok) expect(moved.issues[0].message).toMatch(/bloccata/)
  })

  it('gestisce creazione, duplicazione, rinomina, selezione, reset e applicazione esplicita', () => {
    const session = makeSession()
    const changed = patchScenario(session, 'scenario-1', { hydrationPct: 72 }, [], now).session
    const duplicate = createAlternativeScenario(changed, 'scenario-2', now, 'scenario-1')
    const renamed = renameScenario(duplicate, 'scenario-2', 'Idratazione alta', now)
    const selected = selectScenario(renamed, 'scenario-2', now)
    expect(selected.scenarios[1].name).toBe('Idratazione alta')
    expect(selected.scenarios[1].configuration.hydrationPct).toBe(72)
    expect(prepareScenarioApplication(selected, 'scenario-2', false)).toBeNull()
    expect(prepareScenarioApplication(selected, 'scenario-2', true)?.hydrationPct).toBe(72)
    expect(resetScenario(selected, 'scenario-1', now).scenarios[0].configuration.hydrationPct).toBe(session.baselineConfiguration.hydrationPct)
  })

  it('serializza e ripristina sessioni versionate senza scartare dati corrotti', () => {
    const workspace = { version: 1 as const, activeSessionId: 'lab-session-1', sessions: [makeSession()] }
    writeStored('lievia.test.lab.v1', workspace)
    expect(normalizeLabWorkspace(readStored<unknown>('lievia.test.lab.v1', null))).toEqual(workspace)
    expect(() => normalizeLabWorkspace({ version: 9, sessions: [makeSession()] })).toThrow(/non riconosciuto/)
    expect(() => normalizeLabWorkspace({ version: 1, sessions: [{ id: 'bad' }] })).toThrow(/Nessuno scenario è stato scartato/)
  })

  it('preserva tutte le sessioni e gli scenari validi presenti in LocalStorage', () => {
    const source = makeSession()
    const scenarios = Array.from({ length: 55 }, (_, index) => ({
      ...source.scenarios[0],
      id: `scenario-${index}`,
      name: `Scenario ${index}`,
    }))
    const sessions = Array.from({ length: 21 }, (_, index) => ({
      ...source,
      id: `session-${index}`,
      scenarios,
      selectedScenarioId: scenarios[0].id,
    }))
    const normalized = normalizeLabWorkspace({ version: 1, activeSessionId: sessions[20].id, sessions })
    expect(normalized.sessions).toHaveLength(21)
    expect(normalized.sessions.every((session) => session.scenarios.length === 55)).toBe(true)
    expect(normalized.activeSessionId).toBe(sessions[20].id)
  })
})