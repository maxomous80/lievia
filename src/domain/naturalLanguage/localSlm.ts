import type { Flour } from '../../models'
import { isFlourBlendEligible } from '../flours/blendProperties'
import { validateRecipePatch, type RecipePatch } from '../lab/scenarios'
import { DeterministicItalianInterpreter } from './deterministicItalianInterpreter'
import type { NaturalLanguageContext, NaturalLanguageInterpretation } from './types'

export const LOCAL_SLM_MODEL = {
  id: 'onnx-community/Qwen2.5-0.5B-Instruct',
  precision: 'Q4F16',
  estimatedModelBytes: 483_000_000,
} as const

export const LOCAL_SLM_MIN_REPORTED_MEMORY_GB = 4

export type LocalSLMFailureCode = 'unsupported-browser' | 'insufficient-memory' | 'download-failed' | 'initialization-failed' | 'inference-failed'

export class LocalSLMError extends Error {
  readonly code: LocalSLMFailureCode

  constructor(code: LocalSLMFailureCode, message: string) {
    super(message)
    this.code = code
    this.name = 'LocalSLMError'
  }
}

export function checkLocalSLMCapability(input: {
  secureContext: boolean
  webGPUAvailable: boolean
  deviceMemoryGb?: number
}): { supported: boolean; code?: 'secure-context' | 'unsupported-browser' | 'insufficient-memory'; message?: string } {
  if (!input.secureContext) return { supported: false, code: 'secure-context', message: 'WebGPU richiede un contesto sicuro (HTTPS o localhost).' }
  if (!input.webGPUAvailable) return { supported: false, code: 'unsupported-browser', message: 'Questo browser non espone WebGPU. Il modello locale non è disponibile.' }
  if (input.deviceMemoryGb !== undefined && input.deviceMemoryGb < LOCAL_SLM_MIN_REPORTED_MEMORY_GB) {
    return { supported: false, code: 'insufficient-memory', message: `Il browser segnala circa ${input.deviceMemoryGb} GB di memoria; il caricamento locale è disabilitato per ridurre il rischio di esaurimento memoria.` }
  }
  return { supported: true }
}

export type LocalSLMStatus = 'candidate' | 'clarify' | 'unsupported' | 'invalid'

export interface LocalSLMResult {
  status: LocalSLMStatus
  message: string
  patch: Partial<RecipePatch>
  proposedConfiguration: NaturalLanguageContext['currentConfiguration'] | null
  validationErrors: string[]
  rawOutput: string
}

export interface LocalSLMProgress {
  status: string
  progress?: number
  file?: string
}

export interface LocalSLMRuntime {
  load(onProgress: (progress: LocalSLMProgress) => void, signal: AbortSignal): Promise<void>
  generate(prompt: string, signal: AbortSignal): Promise<string>
  dispose(): void
}

export interface LocalSLMInterpretation {
  interpret(text: string, context: NaturalLanguageContext, signal: AbortSignal): Promise<LocalSLMResult>
}

type WorkerRequest = { type: 'load' } | { type: 'generate'; id: number; prompt: string }

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; progress: unknown }
  | { type: 'result'; id: number; output: unknown }
  | { type: 'error'; id?: number; code?: LocalSLMFailureCode; message: string }

const allowedPatchKeys = new Set([
  'style', 'ballCount', 'ballWeight', 'totalDoughWeight', 'useTotalWeight', 'hydrationPct', 'saltPct', 'oilPct', 'flourBlend', 'fermentation',
])
const allowedFermentationKeys = new Set([
  'strategy', 'totalDurationMinutes', 'bakingAt', 'ambientTemperatureC', 'refrigeratorTemperatureC', 'measuredDoughTemperatureC', 'availability',
])
const allowedAvailabilityKeys = new Set(['avoidRestHours', 'unavailableStart', 'unavailableEnd'])
const allowedStyles = new Set(['napoletana', 'contemporanea', 'romana', 'teglia', 'padellino', 'focaccia', 'personalizzato'])
const allowedStrategies = new Set(['room-temperature', 'refrigerated', 'combined', 'custom'])

export class LocalSLMInterpreter implements LocalSLMInterpretation {
  private runtime: LocalSLMRuntime | null = null
  private readonly createRuntime: () => LocalSLMRuntime

  constructor(createRuntime: () => LocalSLMRuntime = createWorkerRuntime) {
    this.createRuntime = createRuntime
  }

  async load(onProgress: (progress: LocalSLMProgress) => void, signal: AbortSignal): Promise<void> {
    if (this.runtime) return
    const runtime = this.createRuntime()
    try {
      await runtime.load(onProgress, signal)
      if (signal.aborted) throw new DOMException('Caricamento annullato.', 'AbortError')
      this.runtime = runtime
    } catch (error) {
      runtime.dispose()
      throw error
    }
  }

  async interpret(text: string, context: NaturalLanguageContext, signal: AbortSignal): Promise<LocalSLMResult> {
    if (!this.runtime) throw new Error('Carica il modello con il pulsante dedicato prima di provarlo.')
    try {
      const rawOutput = await this.runtime.generate(buildLocalSLMPrompt(text, context), signal)
      return parseLocalSLMOutput(rawOutput, context)
    } catch (error) {
      this.runtime.dispose()
      this.runtime = null
      throw error
    }
  }

  dispose(): void {
    this.runtime?.dispose()
    this.runtime = null
  }
}

export function parseLocalSLMOutput(rawOutput: string, context: NaturalLanguageContext): LocalSLMResult {
  const safeRawOutput = safeText(rawOutput, 1500)
  let decoded: unknown
  try {
    decoded = JSON.parse(rawOutput)
  } catch {
    return invalidResult('Il modello non ha restituito JSON valido.', safeRawOutput)
  }
  if (!isRecord(decoded) || Object.keys(decoded).some((key) => !['status', 'patch', 'message'].includes(key)) ||
    !['candidate', 'clarify', 'unsupported'].includes(String(decoded.status)) || typeof decoded.message !== 'string' || !isRecord(decoded.patch)) {
    return invalidResult('La risposta non rispetta il formato strutturato previsto.', safeRawOutput)
  }

  const message = safeText(decoded.message, 800)
  const status = decoded.status as Exclude<LocalSLMStatus, 'invalid'>
  if (Object.keys(decoded.patch).some((key) => !allowedPatchKeys.has(key))) {
    return invalidResult('La proposta contiene campi non consentiti.', safeRawOutput, message)
  }
  if (status !== 'candidate') {
    return Object.keys(decoded.patch).length
      ? invalidResult('Una risposta di chiarimento o astensione non può includere modifiche.', safeRawOutput, message)
      : { status, message, patch: {}, proposedConfiguration: null, validationErrors: [], rawOutput: safeRawOutput }
  }
  if (!Object.keys(decoded.patch).length) return invalidResult('La proposta non contiene modifiche esplicite.', safeRawOutput, message)

  const patch = decoded.patch as Record<string, unknown>
  const schemaError = validateCandidateShape(patch, context.flours)
  if (schemaError) return invalidResult(schemaError, safeRawOutput, message)
  const validation = validateRecipePatch(context.currentConfiguration, patch, context.flours)
  if (!validation.ok) {
    return { status: 'invalid', message, patch: patch as Partial<RecipePatch>, proposedConfiguration: null,
      validationErrors: validation.issues.map(({ message: issueMessage }) => safeText(issueMessage, 200)), rawOutput: safeRawOutput }
  }
  return { status, message, patch: patch as Partial<RecipePatch>, proposedConfiguration: validation.configuration, validationErrors: [], rawOutput: safeRawOutput }
}

export async function interpretWithDeterministicFallback(
  text: string,
  context: NaturalLanguageContext,
  local: LocalSLMInterpretation,
  signal: AbortSignal,
  deterministic = new DeterministicItalianInterpreter(),
): Promise<{ source: 'local-slm'; result: LocalSLMResult } | { source: 'deterministic-fallback'; result: NaturalLanguageInterpretation; reason: string }> {
  try {
    return { source: 'local-slm', result: await local.interpret(text, context, signal) }
  } catch (error) {
    if (signal.aborted) throw error
    return {
      source: 'deterministic-fallback',
      result: deterministic.interpret(text, context),
      reason: safeText(error instanceof Error ? error.message : 'Il modello locale non è disponibile.', 300),
    }
  }
}

export type ConservativeHybridResult =
  | { source: 'deterministic'; deterministic: NaturalLanguageInterpretation; result: NaturalLanguageInterpretation }
  | { source: 'local-slm'; deterministic: NaturalLanguageInterpretation; result: LocalSLMResult }
  | { source: 'deterministic-fallback'; deterministic: NaturalLanguageInterpretation; result: NaturalLanguageInterpretation; reason: string }

export async function interpretConservatively(
  text: string,
  context: NaturalLanguageContext,
  local: LocalSLMInterpretation,
  signal: AbortSignal,
  deterministic = new DeterministicItalianInterpreter(),
): Promise<ConservativeHybridResult> {
  const baseline = deterministic.interpret(text, context)
  const unresolved = baseline.ambiguities.length > 0 || baseline.validationErrors.length > 0 || baseline.unsupportedRequests.length > 0 ||
    baseline.intent === 'unsupported' || Object.keys(baseline.patch).length === 0
  if (!unresolved) return { source: 'deterministic', deterministic: baseline, result: baseline }

  if (baseline.ambiguities.length > 0) {
    return { source: 'deterministic', deterministic: baseline, result: baseline }
  }

  const outcome = await interpretWithDeterministicFallback(text, context, local, signal, deterministic)
  if (outcome.source === 'deterministic-fallback') return { ...outcome, deterministic: baseline }
  if (outcome.result.status === 'invalid') {
    return {
      source: 'deterministic-fallback',
      deterministic: baseline,
      result: baseline,
      reason: outcome.result.validationErrors.join(' ') || outcome.result.message,
    }
  }
  if (outcome.result.status !== 'candidate') return { source: 'local-slm', deterministic: baseline, result: outcome.result }

  const modelFields = Object.keys(outcome.result.patch)
  const conflicts = [...new Set([
    ...Object.keys(baseline.patch).filter((key) => Object.hasOwn(outcome.result.patch, key) &&
      !sameStructuredValue((baseline.patch as Record<string, unknown>)[key], (outcome.result.patch as Record<string, unknown>)[key])),
    ...baseline.ambiguities.flatMap(({ field }) => modelFields.filter((key) => key === field || key.startsWith(`${field}.`) || field.startsWith(`${key}.`))),
  ])]
  if (conflicts.length) {
    return {
      source: 'local-slm',
      deterministic: baseline,
      result: {
        ...outcome.result,
        status: 'clarify',
        message: 'La proposta locale contraddice una modifica esplicita. Nessuna delle due viene selezionata; chiarisci la richiesta.',
        patch: {},
        proposedConfiguration: null,
        validationErrors: [`Campi in conflitto: ${conflicts.join(', ')}`],
      },
    }
  }
  return { source: 'local-slm', deterministic: baseline, result: outcome.result }
}

export function buildLocalSLMPrompt(text: string, context: NaturalLanguageContext): string {
  const catalogue = context.flours.filter(isFlourBlendEligible).map(({ id, brand, name }) => ({ id, label: `${brand} ${name}` }))
  const current = context.currentConfiguration
  const baseline = {
    style: current.style,
    ballCount: current.ballCount,
    ballWeight: current.ballWeight,
    totalDoughWeight: current.totalDoughWeight,
    useTotalWeight: current.useTotalWeight,
    hydrationPct: current.hydrationPct,
    saltPct: current.saltPct,
    oilPct: current.oilPct,
    flourBlend: current.flourBlend,
    fermentation: {
      strategy: current.fermentation.strategy,
      totalDurationMinutes: current.fermentation.totalDurationMinutes,
      bakingAt: current.fermentation.bakingAt,
      ambientTemperatureC: current.fermentation.ambientTemperatureC,
      refrigeratorTemperatureC: current.fermentation.refrigeratorTemperatureC,
      measuredDoughTemperatureC: current.fermentation.measuredDoughTemperatureC,
      availability: current.fermentation.availability,
    },
  }
  return [
    'Interpreta la richiesta in italiano come proposta di modifica per un impasto.',
    'Non inventare dati mancanti. Non proporre, modificare o calcolare dosi o tipi di lievito.',
    'Non calcolare fattibilità o validità del piano: questi controlli vengono eseguiti dall’app.',
    'Per le farine seleziona solo un ID esatto dal catalogo seguente; se il riferimento non è univoco, restituisci status "clarify".',
    'Campi ammessi in patch: style, ballCount, ballWeight, totalDoughWeight, useTotalWeight, hydrationPct, saltPct, oilPct, flourBlend, fermentation.',
    'In fermentation sono ammessi solo strategy, totalDurationMinutes, bakingAt, ambientTemperatureC, refrigeratorTemperatureC, measuredDoughTemperatureC, availability.',
    'strategy deve essere room-temperature, refrigerated, combined o custom. bakingAt deve essere ISO UTC. availability accetta solo avoidRestHours, unavailableStart e unavailableEnd.',
    'Restituisci un solo oggetto JSON con esattamente status (candidate, clarify o unsupported), patch (oggetto) e message (testo semplice).',
    'Una risposta clarify o unsupported deve avere patch vuota. Non includere markdown o blocchi di codice.',
    `Riferimento temporale: ${context.now.toISOString()} nel fuso ${context.timeZone}.`,
    `Configurazione di partenza, solo contesto: ${JSON.stringify(baseline)}`,
    `Catalogo farine: ${JSON.stringify(catalogue)}`,
    `Richiesta utente: ${safeText(text, 2000)}`,
  ].join('\n')
}

function validateCandidateShape(patch: Record<string, unknown>, flours: Flour[]): string | null {
  for (const key of Object.keys(patch)) if (!allowedPatchKeys.has(key)) return `Campo non consentito: ${key}.`
  if (patch.style !== undefined && (typeof patch.style !== 'string' || !allowedStyles.has(patch.style))) return 'Lo stile non è riconosciuto.'
  if (patch.flourBlend !== undefined) {
    if (!Array.isArray(patch.flourBlend)) return 'La miscela di farine non è valida.'
    const eligibleIds = new Set(flours.filter(isFlourBlendEligible).map(({ id }) => id))
    for (const entry of patch.flourBlend) {
      if (!isRecord(entry) || !exactKeys(entry, ['flourId', 'percentage']) || typeof entry.flourId !== 'string' || !eligibleIds.has(entry.flourId)) {
        return 'La proposta contiene una farina non presente nel catalogo utilizzabile.'
      }
    }
  }
  if (patch.fermentation !== undefined) {
    if (!isRecord(patch.fermentation)) return 'La modifica alla fermentazione non è valida.'
    for (const key of Object.keys(patch.fermentation)) if (!allowedFermentationKeys.has(key)) return `Campo di fermentazione non consentito: ${key}.`
    const fermentation = patch.fermentation
    if (fermentation.strategy !== undefined && (typeof fermentation.strategy !== 'string' || !allowedStrategies.has(fermentation.strategy))) return 'La strategia di fermentazione non è riconosciuta.'
    if (fermentation.availability !== undefined) {
      if (!isRecord(fermentation.availability) || Object.keys(fermentation.availability).some((key) => !allowedAvailabilityKeys.has(key))) return 'La disponibilità indicata non è valida.'
    }
  }
  return null
}

function createWorkerRuntime(): LocalSLMRuntime {
  let worker: Worker | null = null
  let nextRequestId = 0

  function getWorker(): Worker {
    if (!worker) worker = new Worker(new URL('./localSlm.worker.ts', import.meta.url), { type: 'module' })
    return worker
  }

  function request<T>(message: WorkerRequest, signal: AbortSignal, onProgress?: (progress: LocalSLMProgress) => void): Promise<T> {
    const activeWorker = getWorker()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        activeWorker.removeEventListener('message', handleMessage)
        activeWorker.removeEventListener('error', handleError)
        signal.removeEventListener('abort', handleAbort)
      }
      const handleAbort = () => {
        cleanup()
        activeWorker.terminate()
        if (worker === activeWorker) worker = null
        reject(new DOMException('Operazione annullata.', 'AbortError'))
      }
      const handleError = () => {
        cleanup()
        activeWorker.terminate()
        if (worker === activeWorker) worker = null
        reject(new Error('Il worker del modello locale si è interrotto.'))
      }
      const handleMessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data
        if (response.type === 'progress') {
          const progress = normalizeProgress(response.progress)
          onProgress?.(progress)
          return
        }
        if (response.type === 'result' && message.type === 'generate' && response.id !== message.id) return
        if (response.type === 'error' && 'id' in response && message.type === 'generate' && response.id !== message.id) return
        if (response.type === 'ready' || response.type === 'result') {
          cleanup()
          resolve(response as T)
        } else if (response.type === 'error') {
          cleanup()
          reject(new LocalSLMError(response.code ?? (message.type === 'load' ? 'initialization-failed' : 'inference-failed'), safeText(response.message, 300)))
        }
      }
      if (signal.aborted) {
        handleAbort()
        return
      }
      activeWorker.addEventListener('message', handleMessage)
      activeWorker.addEventListener('error', handleError)
      signal.addEventListener('abort', handleAbort, { once: true })
      activeWorker.postMessage(message)
    })
  }

  return {
    async load(onProgress, signal) {
      await request({ type: 'load' }, signal, onProgress)
    },
    async generate(prompt, signal) {
      const id = ++nextRequestId
      const response = await request<{ type: 'result'; id: number; output: unknown }>({ type: 'generate', id, prompt }, signal)
      return extractGeneratedText(response.output)
    },
    dispose() {
      worker?.terminate()
      worker = null
    },
  }
}

function extractGeneratedText(output: unknown): string {
  if (!Array.isArray(output) || !output.length || !isRecord(output[0]) || !('generated_text' in output[0])) throw new Error('Il modello ha restituito un risultato vuoto.')
  const generated = output[0].generated_text
  if (typeof generated === 'string') return safeText(generated, 4000)
  if (Array.isArray(generated)) {
    const last = generated.at(-1)
    if (isRecord(last) && typeof last.content === 'string') return safeText(last.content, 4000)
  }
  throw new Error('Il modello non ha restituito testo interpretabile.')
}

function normalizeProgress(value: unknown): LocalSLMProgress {
  if (!isRecord(value)) return { status: 'Caricamento modello' }
  return {
    status: typeof value.status === 'string' ? safeText(value.status, 120) : 'Caricamento modello',
    progress: typeof value.progress === 'number' && Number.isFinite(value.progress) ? Math.min(100, Math.max(0, value.progress)) : undefined,
    file: typeof value.file === 'string' ? safeText(value.file, 120) : undefined,
  }
}

function invalidResult(message: string, rawOutput: string, modelMessage = ''): LocalSLMResult {
  return { status: 'invalid', message: safeText(modelMessage || message, 800), patch: {}, proposedConfiguration: null,
    validationErrors: [message], rawOutput }
}

function safeText(value: string, maxLength: number): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0)!
      return code > 8 && code !== 11 && code !== 12 && (code < 14 || code > 31) && code !== 127
    })
    .join('')
    .slice(0, maxLength)
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameStructuredValue(value, right[index]))
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameStructuredValue(left[key], right[key]))
  }
  return left === right
}