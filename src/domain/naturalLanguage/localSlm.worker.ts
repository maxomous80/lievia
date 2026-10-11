type WorkerRequest = { type: 'load' } | { type: 'generate'; id: number; prompt: string }
type WorkerErrorCode = 'unsupported-browser' | 'insufficient-memory' | 'download-failed' | 'initialization-failed' | 'inference-failed'

const workerScope = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}
type TextGenerator = (messages: Array<{ role: 'system' | 'user'; content: string }>, options: Record<string, unknown>) => Promise<unknown>
let generator: TextGenerator | null = null

workerScope.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    let downloadStarted = false
    try {
      if (!('gpu' in navigator) || !Reflect.get(navigator, 'gpu')) throw codedError('unsupported-browser', 'WebGPU non è disponibile in questo browser o contesto.')
      const gpu = Reflect.get(navigator, 'gpu') as { requestAdapter?: () => Promise<object | null> }
      const adapter = typeof gpu.requestAdapter === 'function' ? await gpu.requestAdapter() : null
      if (!adapter) throw codedError('unsupported-browser', 'Non è disponibile un adattatore WebGPU utilizzabile.')
      const deviceMemory = Reflect.get(navigator, 'deviceMemory')
      if (typeof deviceMemory === 'number' && deviceMemory < 4) throw codedError('insufficient-memory', `Il browser segnala circa ${deviceMemory} GB di memoria; caricamento annullato.`)
      const { pipeline } = await import('@huggingface/transformers')
      generator = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
        device: 'webgpu',
        dtype: 'q4f16',
        progress_callback: (progress: unknown) => {
          const record = typeof progress === 'object' && progress !== null ? progress as Record<string, unknown> : {}
          if (record.status === 'download' || record.status === 'progress') downloadStarted = true
          workerScope.postMessage({ type: 'progress', progress })
        },
      }) as unknown as TextGenerator
      workerScope.postMessage({ type: 'ready' })
    } catch (error) {
      const fallbackCode = isMemoryError(error) ? 'insufficient-memory' : downloadStarted || /fetch|network|download|http/i.test(error instanceof Error ? error.message : '') ? 'download-failed' : 'initialization-failed'
      const code = isCodedError(error) ? error.code : fallbackCode
      workerScope.postMessage({ type: 'error', code, message: error instanceof Error ? error.message : 'Caricamento del modello non riuscito.' })
    }
    return
  }

  if (data.type === 'generate') {
    if (!generator) {
      workerScope.postMessage({ type: 'error', id: data.id, message: 'Il modello non è caricato.' })
      return
    }
    try {
      const output = await generator([
        { role: 'system', content: 'Estrai solo modifiche esplicitamente richieste dall’utente. Restituisci esclusivamente JSON conforme allo schema richiesto.' },
        { role: 'user', content: data.prompt },
      ], { max_new_tokens: 256, do_sample: false, return_full_text: false })
      workerScope.postMessage({ type: 'result', id: data.id, output })
    } catch (error) {
      const code = isMemoryError(error) ? 'insufficient-memory' : 'inference-failed'
      workerScope.postMessage({ type: 'error', id: data.id, code, message: error instanceof Error ? error.message : 'Inferenza locale non riuscita.' })
    }
  }
}

function codedError(code: WorkerErrorCode, message: string): Error & { code: WorkerErrorCode } {
  return Object.assign(new Error(message), { code })
}

function isCodedError(value: unknown): value is Error & { code: WorkerErrorCode } {
  return value instanceof Error && 'code' in value
}

function isMemoryError(value: unknown): boolean {
  return value instanceof Error && /out of memory|memory|allocation|buffer size/i.test(value.message)
}