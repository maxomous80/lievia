import { describe, expect, it } from 'vitest'
import { normalizeRecipes } from './migration'
import { DEFAULT_USER_AVAILABILITY, isWithinAvailableHours, optimizeFermentationSchedule } from './availability'
import { buildSchedule, createDefaultFermentationConfig, updatePhase } from './schedule'
import type { FermentationConfig, FermentationPhase } from './types'
import { createDefaultDraft } from '../../data/defaults'

function makePhase(id: string, type: FermentationPhase['type'], durationMinutes: number): FermentationPhase {
  const environment = type === 'refrigeration' ? 'refrigerator' : 'ambient'
  return { id, type, durationMinutes, startAt: '', endAt: '', environment, temperatureC: 22, notes: '' }
}

function makeConfig(phases: FermentationPhase[], start = '2026-10-10T20:30:00.000Z'): FermentationConfig {
  const totalDurationMinutes = phases.reduce((sum, phase) => sum + phase.durationMinutes, 0)
  const plannedStartAt = new Date(start).toISOString()
  const bakingAt = new Date(new Date(start).getTime() + totalDurationMinutes * 60_000).toISOString()
  const config = {
    ...createDefaultFermentationConfig(new Date(start)),
    plannedStartAt,
    bakingAt,
    totalDurationMinutes,
    availability: { ...DEFAULT_USER_AVAILABILITY },
  }
  return { ...config, phases: buildSchedule(phases, plannedStartAt, totalDurationMinutes) }
}

describe('disponibilità e ottimizzazione del piano', () => {
  it('riconosce intervalli notturni e richiede che l’intera operazione sia disponibile', () => {
    expect(isWithinAvailableHours(new Date('2026-10-10T22:45:00'), new Date('2026-10-10T23:00:00'), DEFAULT_USER_AVAILABILITY)).toBe(true)
    expect(isWithinAvailableHours(new Date('2026-10-10T22:55:00'), new Date('2026-10-10T23:05:00'), DEFAULT_USER_AVAILABILITY)).toBe(false)
    expect(isWithinAvailableHours(new Date('2026-10-11T07:55:00'), new Date('2026-10-11T08:05:00'), DEFAULT_USER_AVAILABILITY)).toBe(false)
    expect(isWithinAvailableHours(new Date('2026-10-11T08:00:00'), new Date('2026-10-11T08:15:00'), DEFAULT_USER_AVAILABILITY)).toBe(true)
  })

  it('sposta lo staglio fuori dalle ore di riposo senza cambiare cottura o durate manuali', () => {
    const config = makeConfig([
      makePhase('mix', 'mixing', 15),
      makePhase('bulk', 'bulk-fermentation', 450),
      makePhase('divide', 'dividing', 15),
      makePhase('proof', 'final-proof', 960),
    ])
    const optimized = optimizeFermentationSchedule(config)
    expect(optimized.ok).toBe(true)
    expect(optimized.config?.bakingAt).toBe(config.bakingAt)
    expect(new Date(optimized.config!.phases.find(({ id }) => id === 'divide')!.startAt).getHours()).toBe(8)
    expect(optimized.config?.phases.filter(({ type }) => ['mixing', 'dividing'].includes(type)).map(({ durationMinutes }) => durationMinutes)).toEqual([15, 15])
    expect(optimized.config?.phases.at(-1)?.endAt).toBe(config.bakingAt)
  })

  it('non sposta un’operazione manuale bloccata e segnala un lock incompatibile', () => {
    const config = makeConfig([
      makePhase('mix', 'mixing', 15),
      makePhase('bulk', 'bulk-fermentation', 735),
      { ...makePhase('divide', 'dividing', 15), boundaryLocked: true },
      makePhase('proof', 'final-proof', 675),
    ])
    const lockedAt = config.phases.find(({ id }) => id === 'divide')!.startAt
    const optimized = optimizeFermentationSchedule(config)
    expect(optimized.ok).toBe(true)
    expect(optimized.config?.phases.find(({ id }) => id === 'divide')?.startAt).toBe(lockedAt)
    expect(() => updatePhase(config, 'proof', { durationMinutes: 676 })).toThrow(/operazione bloccata/)

    const nightLock = makeConfig([
      { ...makePhase('mix', 'mixing', 15), boundaryLocked: true },
      makePhase('bulk', 'bulk-fermentation', 735),
      makePhase('divide', 'dividing', 15),
      makePhase('proof', 'final-proof', 675),
    ], '2026-10-10T20:50:00.000Z')
    expect(optimizeFermentationSchedule(nightLock).conflicts.join(' ')).toContain('orario bloccato')
  })

  it('riporta l’incompatibilità tra finestra, cottura e attività manuale', () => {
    const config = makeConfig([makePhase('mix', 'mixing', 60)], '2026-10-10T23:00:00.000Z')
    const result = optimizeFermentationSchedule(config)
    expect(result.ok).toBe(false)
    expect(result.conflicts.join(' ')).toContain('Non c’è una finestra disponibile')
  })

  it('rispetta i limiti espliciti delle fasi flessibili e segnala limiti incompatibili', () => {
    const bounded = makeConfig([
      makePhase('mix', 'mixing', 15),
      { ...makePhase('bulk', 'bulk-fermentation', 450), minimumDurationMinutes: 500, maximumDurationMinutes: 600 },
      makePhase('divide', 'dividing', 15),
      makePhase('proof', 'final-proof', 960),
    ])
    const optimized = optimizeFermentationSchedule(bounded)
    const bulkMinutes = optimized.config?.phases.find(({ id }) => id === 'bulk')?.durationMinutes
    expect(optimized.ok).toBe(true)
    expect(bulkMinutes).toBeGreaterThanOrEqual(500)
    expect(bulkMinutes).toBeLessThanOrEqual(600)

    const impossible = makeConfig([
      makePhase('mix', 'mixing', 15),
      { ...makePhase('bulk', 'bulk-fermentation', 450), minimumDurationMinutes: 700, maximumDurationMinutes: 700 },
      makePhase('divide', 'dividing', 15),
      { ...makePhase('proof', 'final-proof', 960), minimumDurationMinutes: 720 },
    ])
    expect(optimizeFermentationSchedule(impossible).ok).toBe(false)
  })

  it('ottimizza piani di più giorni mantenendo cronologia continua e cottura', () => {
    const config = makeConfig([
      makePhase('mix', 'mixing', 15),
      makePhase('bulk', 'bulk-fermentation', 2000),
      makePhase('divide', 'dividing', 15),
      makePhase('proof', 'final-proof', 1570),
    ], '2026-10-09T20:30:00.000Z')
    const optimized = optimizeFermentationSchedule(config)
    expect(optimized.ok).toBe(true)
    expect(optimized.config?.bakingAt).toBe(config.bakingAt)
    expect(new Date(optimized.config!.phases[2].startAt).getUTCDate()).toBeGreaterThan(new Date(config.plannedStartAt).getUTCDate())
    expect(optimized.config?.phases.every((phase, index, phases) => index === 0 || phase.startAt === phases[index - 1].endAt)).toBe(true)
  })

  it('mantiene piano esistente finché l’utente non richiede ottimizzazione e migra le preferenze', () => {
    const recipe = { ...createDefaultDraft('demo-00'), id: 'availability-migration', name: 'Piano salvato', createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z', version: 1,
      fermentation: { ...createDefaultFermentationConfig(), availability: { avoidRestHours: false, unavailableStart: '22:30', unavailableEnd: '07:15' } } }
    const [restored] = normalizeRecipes([recipe])
    const restoredPlan = restored.fermentation!
    expect(restoredPlan.availability).toEqual({ avoidRestHours: false, unavailableStart: '22:30', unavailableEnd: '07:15' })
    const unchanged = optimizeFermentationSchedule(restoredPlan)
    expect(unchanged.config).toBe(restoredPlan)
  })
})