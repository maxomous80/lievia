import { describe, expect, it, vi } from 'vitest'
import { deserializeVersioned, readStored, readStoredStrict, serializeVersioned, writeStored, writeStoredBatch } from './storage'

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

  it('rifiuta una lettura protetta malformata senza sostituirla con il fallback', () => {
    window.localStorage.setItem('lievia-test-strict', '{')
    expect(() => readStoredStrict('lievia-test-strict', [])).toThrow()
    expect(window.localStorage.getItem('lievia-test-strict')).toBe('{')
    window.localStorage.removeItem('lievia-test-strict')
  })

  it('salva e rilegge una collezione tramite LocalStorage', () => {
    const original = [{ id: 'ricetta-1', nome: 'Impasto' }]
    writeStored('lievia-test', original)
    expect(readStored('lievia-test', [])).toEqual(original)
    window.localStorage.removeItem('lievia-test')
  })

  it('segnala un errore di quota invece di nasconderlo', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('spazio esaurito', 'QuotaExceededError')
    })
    const listener = vi.fn()
    window.addEventListener('lievia:storage-write', listener)
    writeStored('lievia-quota-test', [{ id: 'osservazione' }])
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0]).toMatchObject({ detail: { message: expect.stringContaining('spazio LocalStorage esaurito') } })
    window.removeEventListener('lievia:storage-write', listener)
    setItem.mockRestore()
  })

  it('ripristina tutte le chiavi se un batch di importazione fallisce per quota', () => {
    window.localStorage.setItem('batch-a', serializeVersioned(['locale-a']))
    window.localStorage.setItem('batch-b', serializeVersioned(['locale-b']))
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'batch-b' && value.includes('importato')) throw new DOMException('spazio esaurito', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })
    const result = writeStoredBatch([{ key: 'batch-a', data: ['importato-a'] }, { key: 'batch-b', data: ['importato-b'] }])
    expect(result).toMatchObject({ ok: false, rollbackSucceeded: true, message: expect.stringContaining('backup') })
    expect(readStored('batch-a', [])).toEqual(['locale-a'])
    expect(readStored('batch-b', [])).toEqual(['locale-b'])
    setItem.mockRestore()
    window.localStorage.removeItem('batch-a')
    window.localStorage.removeItem('batch-b')
  })
})