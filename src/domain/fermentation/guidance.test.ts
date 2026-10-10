import { describe, expect, it } from 'vitest'
import { OFFICIAL_FLOURS } from '../../data/officialFlours'
import { getFlourGuidance } from './guidance'

describe('indicazioni fermentative e dati commerciali', () => {
  it('non usa il midpoint W ufficiale come misura puntuale per giudicare un piano lungo', () => {
    const flour = OFFICIAL_FLOURS.find(({ officialSource }) => officialSource?.id === 'official-molino-grassi-miracolo-tipo-1')!
    const warnings = getFlourGuidance({
      blend: [{ flourId: flour.id, percentage: 100 }],
      flours: [{
        id: flour.id,
        name: flour.name,
        strengthW: undefined,
        strengthWRange: { min: flour.officialSource!.wMin, max: flour.officialSource!.wMax },
        proteinPct: undefined,
      }],
      durationMinutes: 25 * 60,
      hydrationPct: 65,
      style: 'contemporanea',
    })
    expect(warnings.map(({ code }) => code)).not.toContain('long-plan-lower-strength')
  })
})