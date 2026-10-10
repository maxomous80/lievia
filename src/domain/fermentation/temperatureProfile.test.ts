import { describe, expect, it } from 'vitest'
import { createDefaultFermentationConfig } from './schedule'
import { estimateFermentationExposure } from './fermentationEstimation'
import { calculateTemperatureProfile, validateThermalParameters } from './temperatureProfile'

describe('profilo termico semplificato', () => {
  it('segue le fasi e non porta istantaneamente l’impasto alla temperatura del frigo', () => {
    const base = createDefaultFermentationConfig(new Date('2026-10-10T12:00:00.000Z'))
    const config = {
      ...base,
      measuredDoughTemperatureC: 24,
      ambientTemperatureC: 22,
      refrigeratorTemperatureC: 4,
      phases: [
        { ...base.phases[0], id: 'ambiente', durationMinutes: 60, environment: 'ambient' as const },
        { ...base.phases[1], id: 'frigo', durationMinutes: 60, environment: 'refrigerator' as const },
        { ...base.phases[2], id: 'ritorno', durationMinutes: 60, environment: 'ambient' as const },
      ],
      totalDurationMinutes: 180,
    }
    const profile = calculateTemperatureProfile(config, { timeConstantMinutes: 120 })
    const fridgeEntry = profile.points.find((point) => point.phaseId === 'frigo')!
    const fridgeExit = [...profile.points].reverse().find((point) => point.phaseId === 'frigo')!
    const recovery = [...profile.points].reverse().find((point) => point.phaseId === 'ritorno')!

    expect(profile.status).toBe('estimated')
    expect(profile.points[0]).toMatchObject({ doughTemperatureC: 24, doughTemperatureSource: 'measured' })
    expect(fridgeEntry.doughTemperatureC).toBeGreaterThan(4)
    expect(fridgeExit.doughTemperatureC).toBeLessThan(fridgeEntry.doughTemperatureC!)
    expect(recovery.doughTemperatureC).toBeGreaterThan(fridgeExit.doughTemperatureC!)
    expect(fridgeExit.surroundingEnvironment).toBe('refrigerator')
    expect(fridgeExit.surroundingTemperatureC).toBe(4)
    expect(fridgeExit.surroundingAirTemperatureC).toBeNull()
    expect(fridgeExit.ambientTemperatureC).toBe(22)
    expect(profile.explanation).toContain('non misure')
  })

  it('non inventa una temperatura iniziale o una curva se mancano misure e parametri', () => {
    const profile = calculateTemperatureProfile(createDefaultFermentationConfig())
    expect(profile.status).toBe('insufficient-data')
    expect(profile.points.every((point) => point.doughTemperatureC === null)).toBe(true)
    expect(profile.explanation).toContain('Curva non stimata')
  })

  it('usa una temperatura iniziale ipotizzata solo come stima esplicita', () => {
    const profile = calculateTemperatureProfile(createDefaultFermentationConfig(), {
      initialDoughTemperatureC: 23,
      timeConstantMinutes: 90,
    })
    expect(profile.status).toBe('estimated')
    expect(profile.points[0].doughTemperatureSource).toBe('estimated')
  })

  it('non estende nel tempo una misura iniziale senza un modello termico', () => {
    const config = { ...createDefaultFermentationConfig(), measuredDoughTemperatureC: 24 }
    const profile = calculateTemperatureProfile(config)
    expect(profile.points[0]).toMatchObject({ doughTemperatureC: 24, doughTemperatureSource: 'measured' })
    expect(profile.points[1]).toMatchObject({ doughTemperatureC: null, doughTemperatureSource: 'unknown' })
  })

  it('non assume una temperatura stabile in una fase riferita solo all’impasto', () => {
    const base = createDefaultFermentationConfig()
    const config = {
      ...base,
      measuredDoughTemperatureC: 24,
      phases: [{ ...base.phases[0], durationMinutes: 30, environment: 'dough' as const }],
      totalDurationMinutes: 30,
    }
    const profile = calculateTemperatureProfile(config, { timeConstantMinutes: 120 })
    expect(profile.points[0].doughTemperatureC).toBe(24)
    expect(profile.points[1].doughTemperatureC).toBeNull()
  })

  it('ancora la stima alla misura reale inserita all’inizio di una fase', () => {
    const base = createDefaultFermentationConfig()
    const config = {
      ...base,
      measuredDoughTemperatureC: 24,
      phases: [
        { ...base.phases[0], id: 'inizio', durationMinutes: 30 },
        { ...base.phases[1], id: 'misura', durationMinutes: 30, environment: 'refrigerator' as const, measuredDoughTemperatureC: 17 },
      ],
      totalDurationMinutes: 60,
    }
    const profile = calculateTemperatureProfile(config, { timeConstantMinutes: 90 })
    const measured = profile.points.find((point) => point.phaseId === 'misura')!
    expect(measured).toMatchObject({ doughTemperatureC: 17, doughTemperatureSource: 'measured', surroundingTemperatureC: 5 })
    expect(profile.points.at(-1)!.doughTemperatureC).toBeLessThan(17)
    expect(profile.points.at(-1)!.doughTemperatureSource).toBe('estimated')
  })

  it('riparte da una misura di fase anche quando manca la misura iniziale globale', () => {
    const base = createDefaultFermentationConfig()
    const config = {
      ...base,
      phases: [
        { ...base.phases[0], id: 'inizio', durationMinutes: 30 },
        { ...base.phases[1], id: 'misura', durationMinutes: 30, environment: 'refrigerator' as const, measuredDoughTemperatureC: 18 },
      ],
      totalDurationMinutes: 60,
    }
    const profile = calculateTemperatureProfile(config, { timeConstantMinutes: 120 })
    const measured = profile.points.find((point) => point.phaseId === 'misura')!
    const estimatedAfter = profile.points.at(-1)!
    expect(profile.status).toBe('estimated')
    expect(measured).toMatchObject({ doughTemperatureC: 18, doughTemperatureSource: 'measured' })
    expect(estimatedAfter.doughTemperatureSource).toBe('estimated')
    expect(estimatedAfter.doughTemperatureC).toBeLessThan(18)
  })

  it('rifiuta parametri termici non validi e segnala i limiti', () => {
    expect(validateThermalParameters({ timeConstantMinutes: 0 })).toHaveLength(1)
    expect(() => calculateTemperatureProfile(createDefaultFermentationConfig(), { timeConstantMinutes: Number.NaN }))
      .toThrow(RangeError)
    expect(validateThermalParameters({ initialDoughTemperatureC: 51 })).toHaveLength(1)
    const config = createDefaultFermentationConfig()
    expect(() => calculateTemperatureProfile({ ...config, phases: [{ ...config.phases[0], measuredDoughTemperatureC: 55 }] }, { timeConstantMinutes: 60 }))
      .toThrow(RangeError)
    expect(() => calculateTemperatureProfile({ ...config, phases: [{ ...config.phases[0], durationMinutes: -1 }] }))
      .toThrow(RangeError)
  })

  it('mantiene non disponibile l’esposizione biologica anche con una curva termica stimata', () => {
    const config = { ...createDefaultFermentationConfig(), measuredDoughTemperatureC: 24 }
    const result = estimateFermentationExposure(config, { timeConstantMinutes: 120 }, { type: 'active-dry', percentageOnFlour: 0.08 })
    expect(result.available).toBe(false)
    expect(result.exposureMinutes).toBeNull()
    expect(result.yeastInput).toEqual({ type: 'active-dry', percentageOnFlour: 0.08 })
    expect(result.temperatureProfile.status).toBe('estimated')
    expect(result.message).toContain('modello cinetico documentato')
  })

  it('espone input termici non validi come profilo non disponibile', () => {
    const result = estimateFermentationExposure(createDefaultFermentationConfig(), { timeConstantMinutes: 0 })
    expect(result.available).toBe(false)
    expect(result.temperatureProfile.status).toBe('insufficient-data')
    expect(result.temperatureProfile.points).toEqual([])
    expect(result.temperatureProfile.explanation).toContain('numero positivo')
  })
})