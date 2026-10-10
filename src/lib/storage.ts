import type { VersionedData } from '../models'

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

export function writeStored<T>(key: string, data: T): void {
  try {
    window.localStorage.setItem(key, serializeVersioned(data))
  } catch {
    // Storage may be unavailable or full; the in-memory app state remains usable.
  }
}