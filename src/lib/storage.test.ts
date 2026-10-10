import { describe, expect, it } from 'vitest'
import { deserializeVersioned, readStored, serializeVersioned, writeStored } from './storage'

describe('persistenza versionata', () => {
  it('serializza e ripristina dati compatibili', () => {
    const original = [{ id: 'farina-1', percentuale: 70 }, { id: 'farina-2', percentuale: 30 }]
    expect(deserializeVersioned(serializeVersioned(original), [])).toEqual(original)
  })

  it('conserva le date come stringhe ISO non ambigue', () => {
    const original = { plannedStartAt: '2026-10-10T18:30:00.000Z', bakingAt: '2026-10-11T18:30:00.000Z' }
    const stored = serializeVersioned(original)
    expect(deserializeVersioned(stored, {})).toEqual(original)
    expect(stored).toContain('2026-10-11T18:30:00.000Z')
  })

  it('usa il valore iniziale per dati malformati o versioni sconosciute', () => {
    expect(deserializeVersioned('{', ['iniziale'])).toEqual(['iniziale'])
    expect(deserializeVersioned('{"version":2,"data":[]}', ['iniziale']))
      .toEqual(['iniziale'])
  })

  it('salva e rilegge una collezione tramite LocalStorage', () => {
    const original = [{ id: 'ricetta-1', nome: 'Impasto' }]
    writeStored('lievia-test', original)
    expect(readStored('lievia-test', [])).toEqual(original)
    window.localStorage.removeItem('lievia-test')
  })
})