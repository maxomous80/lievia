import type { VersionedData } from '../models'

const failedKeys = new Map<string, string>()

export function serializeVersioned<T>(data: T): string {
  return JSON.stringify({ version: 1, data } satisfies VersionedData<T>)
}

export function deserializeVersioned<T>(serialized: string | null, fallback: T): T {
  if (!serialized) return fallback
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (
      typeof parsed === 'object' && parsed !== null &&
      'version' in parsed && parsed.version === 1 &&
      'data' in parsed
    ) {
      return parsed.data as T
    }
  } catch {
    return fallback
  }
  return fallback
}

export function readStored<T>(key: string, fallback: T): T {
  try {
    return deserializeVersioned(window.localStorage.getItem(key), fallback)
  } catch {
    return fallback
  }
}

export function readStoredStrict<T>(key: string, fallback: T): T {
  const serialized = window.localStorage.getItem(key)
  if (serialized === null) return fallback
  const parsed: unknown = JSON.parse(serialized)
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || parsed.version !== 1 || !('data' in parsed)) {
    throw new TypeError(`L’archivio “${key}” non ha una struttura valida.`)
  }
  return parsed.data as T
}

export function writeStored<T>(key: string, data: T): void {
  try {
    window.localStorage.setItem(key, serializeVersioned(data))
    if (failedKeys.delete(key)) notifyStorageWrite(aggregateStorageErrors())
  } catch (error) {
    failedKeys.set(key, storageErrorMessage(error, true))
    notifyStorageWrite(aggregateStorageErrors())
  }
}

export function writeStoredBatch(entries: Array<{ key: string; data: unknown }>): { ok: true } | { ok: false; message: string; rollbackSucceeded: boolean } {
  let storage: Storage | undefined
  const previous = new Map<string, string | null>()
  const written: string[] = []
  try {
    storage = window.localStorage
    for (const { key } of entries) previous.set(key, storage.getItem(key))
    for (const { key, data } of entries) {
      storage.setItem(key, serializeVersioned(data))
      written.push(key)
    }
    for (const { key } of entries) failedKeys.delete(key)
    notifyStorageWrite(aggregateStorageErrors())
    return { ok: true }
  } catch (error) {
    let rollbackSucceeded = true
    for (const key of [...written].reverse()) {
      const oldValue = previous.get(key) ?? null
      try {
        if (!storage) throw new Error('LocalStorage non accessibile durante il ripristino.')
        if (oldValue === null) storage.removeItem(key)
        else storage.setItem(key, oldValue)
      } catch {
        rollbackSucceeded = false
      }
    }
    const message = storageErrorMessage(error, rollbackSucceeded)
    for (const { key } of entries) failedKeys.set(key, message)
    notifyStorageWrite(aggregateStorageErrors())
    return { ok: false, message, rollbackSucceeded }
  }
}

function storageErrorMessage(error: unknown, rollbackSucceeded: boolean) {
  const quotaExceeded = error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014)
  const reason = quotaExceeded
    ? 'spazio LocalStorage esaurito'
    : 'browser o dispositivo ha rifiutato la scrittura'
  return rollbackSucceeded
    ? `Salvataggio non riuscito: ${reason}. I dati in memoria sono ancora visibili ma non sono stati salvati; esporta subito un backup, libera spazio o usa un altro browser prima di chiudere questa pagina.`
    : `Salvataggio non riuscito e ripristino locale incompleto (${reason}). Non chiudere la pagina; esporta subito un backup e recupera una copia valida prima di riprovare.`
}

function notifyStorageWrite(error: unknown, message?: string) {
  if (typeof window === 'undefined') return
  const resolvedMessage = typeof error === 'string' ? error : error ? message ?? storageErrorMessage(error, true) : null
  window.dispatchEvent(new CustomEvent('lievia:storage-write', { detail: { message: resolvedMessage } }))
}

function aggregateStorageErrors() {
  const errors = [...new Set(failedKeys.values())]
  return errors.length ? errors.join(' ') : null
}