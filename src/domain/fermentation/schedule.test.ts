import { describe, expect, it } from 'vitest'
import { calculateDough } from '../../lib/calculator'
import { createDefaultDraft } from '../../data/defaults'
import { getFlourGuidance, getTemperatureGuidance } from './guidance'
import { normalizeRecipes } from './migration'
import {
  buildSchedule,
  calculateBakeFromStart,
  calculateStartFromBake,
  createDefaultFermentationConfig,
  createStrategyPhases,
  phaseDurationTotal,
  updatePhase,
  updateTotalDuration,
} from './schedule'
import { estimateYeast } from './yeast'
import type { FermentationPhase } from './types'

const phase = (id: string, durationMinutes: number): FermentationPhase => ({
  id,
  type: 'bulk-fermentation',
  durationMinutes,
  startAt: '',
  endAt: '',
  environment: 'ambient',
  temperatureC: 22,
  notes: '',
})

describe('pianificazione temporale', () => {
  it('calcola l’inizio a partire dall’orario di cottura', () => {
    const start = calculateStartFromBake('2026-10-11T20:30:00.000Z', 24 * 60)
    expect(start.toISOString()).toBe('2026-10-10T20:30:00.000Z')
  })

  it('calcola la cottura a partire dall’inizio, anche oltre 24 ore', () => {
    const bake = calculateBakeFromStart('2026-10-10T08:15:00.000Z', 31 * 60 + 45)
    expect(bake.toISOString()).toBe('2026-10-11T16:00:00.000Z')
  })

  it('mantiene fasi cronologiche attraverso la mezzanotte', () => {
    const schedule = buildSchedule([phase('a', 60), phase('b', 90)], '2026-10-10T23:30:00.000Z', 150)
    expect(schedule[0].endAt).toBe('2026-10-11T00:30:00.000Z')
    expect(schedule[1].startAt).toBe(schedule[0].endAt)
    expect(schedule[1].endAt).toBe('2026-10-11T02:00:00.000Z')
  })

  it('somma le fasi a durata totale e consente di modificare una fase', () => {
    const config = createDefaultFermentationConfig(new Date('2026-10-10T12:00:00.000Z'))
    const initialBake = config.bakingAt
    const edited = updatePhase(config, config.phases[0].id, { durationMinutes: config.phases[0].durationMinutes + 15, notes: 'Impasto a mano' })
    expect(edited.phases[0].notes).toBe('Impasto a mano')
    expect(edited.phases[0].id).toBe(config.phases[0].id)
    expect(phaseDurationTotal(edited.phases)).toBe(edited.totalDurationMinutes)
    expect(edited.bakingAt).toBe(initialBake)
    expect(new Date(edited.phases[0].endAt).toISOString()).toBe(edited.phases[1].startAt)
  })

  it('rifiuta durate negative e totali che non corrispondono alle fasi', () => {
    expect(() => buildSchedule([phase('a', -1)], '2026-10-10T00:00:00.000Z')).toThrow(RangeError)
    expect(() => buildSchedule([phase('a', 60)], '2026-10-10T00:00:00.000Z', 90)).toThrow(/coincidere/)
    expect(() => updatePhase(createDefaultFermentationConfig(), 'inesistente', {})).toThrow(/non esiste/)
  })

  it('ridimensiona tutte le fasi quando cambia la finestra, senza superare 24 ore', () => {
    const config = createDefaultFermentationConfig(new Date('2026-10-10T12:00:00.000Z'))
    const resized = updateTotalDuration(config, 30 * 60 + 20)
    expect(resized.totalDurationMinutes).toBe(1820)
    expect(phaseDurationTotal(resized.phases)).toBe(1820)
    expect(resized.phases.find(({ type }) => type === 'mixing')?.durationMinutes).toBe(15)
    expect(resized.phases.find(({ type }) => type === 'dividing')?.durationMinutes).toBe(15)
    expect(resized.bakingAt).toBe(config.bakingAt)
    expect(new Date(resized.plannedStartAt).getTime()).toBe(new Date(config.bakingAt).getTime() - 1820 * 60_000)
  })

  it('attraversa il salto DST con durata di tempo trascorso coerente', () => {
    const start = new Date('2026-03-08T06:30:00.000Z')
    const bake = calculateBakeFromStart(start, 120)
    const localTime = (date: Date) => new Intl.DateTimeFormat('it-IT', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date)
    expect(localTime(start)).toBe('01:30')
    expect(localTime(bake)).toBe('04:30')
    expect(bake.getTime() - start.getTime()).toBe(120 * 60_000)
  })

  it('fornisce template senza sovrapporre il tempo operativo', () => {
    const phases = createStrategyPhases('refrigerated', 24 * 60, 23, 5)
    const schedule = buildSchedule(phases, '2026-10-10T20:30:00.000Z', 24 * 60)
    expect(phaseDurationTotal(schedule)).toBe(24 * 60)
    expect(schedule.filter((item) => item.type === 'refrigeration')[0].temperatureC).toBe(5)
    expect(schedule.some((item) => item.type === 'dividing')).toBe(true)
    expect(schedule.some((item) => item.environment === 'refrigerator' && item.type === 'final-proof')).toBe(false)
  })

  it('non genera una raccomandazione numerica di lievito senza modello calibrato', () => {
    const estimate = estimateYeast({ yeastType: 'fresh', flourMassGrams: 600, config: createDefaultFermentationConfig() })
    expect(estimate.available).toBe(false)
    expect(estimate.message).toBe('Stima automatica non ancora calibrata')
    expect(estimate.modelVersion).toBe('un-calibrated')
  })

  it('aggiorna il dosaggio manuale nel calcolatore conservando la massa', () => {
    const recipe = createDefaultDraft('demo-00')
    const compute = (yeastPct: number) => calculateDough({ ...recipe, yeastPct })
    const before = compute(0.15)
    const after = compute(0.25)
    expect(after.yeastWeight).toBeGreaterThan(before.yeastWeight)
    expect(after.totalDoughWeight).toBeCloseTo(before.totalDoughWeight, 8)
    expect(after.flourWeight).toBeLessThan(before.flourWeight)
  })

  it('migra ricette Phase 1 e fasi legacy in ore senza perdere ingredienti o orario', () => {
    const legacy = [{
      id: 'ricetta-phase-1',
      name: 'Impasto salvato',
      style: 'napoletana',
      ballCount: 4,
      ballWeight: 250,
      useTotalWeight: false,
      hydrationPct: 65,
      saltPct: 2.8,
      oilPct: 0,
      yeastType: 'fresh',
      yeastPct: 0.2,
      maltPct: 0,
      sugarPct: 0,
      flourBlend: [{ flourId: 'demo-00', percentage: 100 }],
      doughWeightPerArea: 300,
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z',
      version: 1,
      fermentation: {
        totalDurationHours: 12,
        targetBakeAt: '2026-10-11T20:30:00.000Z',
        ambientTemperatureC: 23,
        refrigeratorTemperatureC: 5,
        phases: [{ durationHours: 3, temperatureC: 23, note: 'Vecchia nota' }],
      },
    }]
    const [migrated] = normalizeRecipes(legacy)
    expect(migrated.hydrationPct).toBe(65)
    expect(migrated.fermentation?.bakingAt).toBe('2026-10-11T20:30:00.000Z')
    expect(migrated.fermentation?.totalDurationMinutes).toBe(720)
    expect(phaseDurationTotal(migrated.fermentation?.phases ?? [])).toBe(720)
  })

  it('conserva il modello e l’override utente durante la migrazione delle ricette', () => {
    const config = createDefaultFermentationConfig()
    const [migrated] = normalizeRecipes([{
      ...createDefaultDraft('demo-00'),
      id: 'ricetta-modello',
      name: 'Ricetta con override',
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z',
      version: 1,
      fermentation: {
        ...config,
        estimatorModelId: 'lievia-yeast-empirical',
        estimatorModelVersion: '0.0.0',
        userYeastDoseOverride: { yeastType: 'instant-dry', yeastPct: 0.08, updatedAt: '2026-10-10T10:00:00.000Z' },
      },
    }])
    expect(migrated.fermentation?.estimatorModelId).toBe('lievia-yeast-empirical')
    expect(migrated.fermentation?.estimatorModelVersion).toBe('0.0.0')
    expect(migrated.fermentation?.userYeastDoseOverride).toMatchObject({ yeastType: 'instant-dry', yeastPct: 0.08 })
  })

  it('segnala combinazioni farina/piano con dati insufficienti o condizioni estreme', () => {
    const config = { ...createDefaultFermentationConfig(), ambientTemperatureC: 34, refrigeratorTemperatureC: 12, totalDurationMinutes: 50 * 60 }
    const temperatureWarnings = getTemperatureGuidance(config)
    const flourWarnings = getFlourGuidance({ blend: [{ flourId: 'demo-00', percentage: 100 }], flours: [{ id: 'demo-00', name: 'Profilo dimostrativo' }], durationMinutes: config.totalDurationMinutes, hydrationPct: 82, style: 'teglia' })
    expect(temperatureWarnings.map(({ code }) => code)).toContain('ambient-temperature-extreme')
    expect(temperatureWarnings.map(({ code }) => code)).toContain('refrigerator-temperature-check')
    expect(flourWarnings.map(({ code }) => code)).toContain('flour-data-incomplete')
    expect(flourWarnings.map(({ code }) => code)).toContain('very-long-plan')
    expect(flourWarnings.map(({ code }) => code)).toContain('high-hydration-unknown-absorption')
  })
})