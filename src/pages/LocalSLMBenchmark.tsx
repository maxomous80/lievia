import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppData } from '../context/useAppData'
import { createBenchmarkContext, summarizeInterpretation } from '../domain/naturalLanguage/benchmark'
import {
  checkLocalSLMCapability,
  interpretConservatively,
  LocalSLMError,
  LOCAL_SLM_MODEL,
  LocalSLMInterpreter,
  type LocalSLMProgress,
} from '../domain/naturalLanguage/localSlm'
import { deterministicItalianInterpreter } from '../domain/naturalLanguage/deterministicItalianInterpreter'

interface DisplayResult {
  elapsedMs: number
  source: string
  output: unknown
  warning?: string
}

const examplePrompt = 'Voglio 6 panetti da 250 grammi al 70% di idratazione, 48 ore in frigorifero a 5 gradi.'

export function LocalSLMBenchmark() {
  const { flourCatalog, pantryEntries } = useAppData()
  const [prompt, setPrompt] = useState(examplePrompt)
  const [progress, setProgress] = useState<LocalSLMProgress | null>(null)
  const [loadError, setLoadError] = useState('')
  const [modelLoaded, setModelLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [deterministicResult, setDeterministicResult] = useState<DisplayResult | null>(null)
  const [localResult, setLocalResult] = useState<DisplayResult | null>(null)
  const abortController = useRef<AbortController | null>(null)
  const interpreter = useMemo(() => new LocalSLMInterpreter(), [])
  const context = useMemo(() => ({ ...createBenchmarkContext(), flours: flourCatalog, pantryEntries }), [flourCatalog, pantryEntries])
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
  const secureContext = typeof window !== 'undefined' && window.isSecureContext
  const deviceMemoryGb = typeof navigator !== 'undefined' && 'deviceMemory' in navigator ? Number(Reflect.get(navigator, 'deviceMemory')) : undefined
  const capability = checkLocalSLMCapability({ secureContext, webGPUAvailable: hasWebGPU, deviceMemoryGb })

  useEffect(() => () => {
    abortController.current?.abort()
    interpreter.dispose()
  }, [interpreter])

  async function loadModel() {
    const controller = new AbortController()
    abortController.current = controller
    setIsLoading(true)
    setLoadError('')
    setProgress({ status: 'Avvio del worker locale' })
    try {
      await interpreter.load(setProgress, controller.signal)
      setModelLoaded(true)
      setProgress({ status: 'Modello caricato e disponibile in questa sessione' })
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(formatSLMError(error))
    } finally {
      if (abortController.current === controller) abortController.current = null
      setIsLoading(false)
    }
  }

  function runDeterministic() {
    if (!prompt.trim()) return
    const start = performance.now()
    const result = deterministicItalianInterpreter.interpret(prompt, context)
    setDeterministicResult({ elapsedMs: performance.now() - start, source: 'Interprete deterministico', output: summarizeInterpretation(result) })
  }

  async function runLocal() {
    if (!prompt.trim() || !modelLoaded) return
    const controller = new AbortController()
    abortController.current = controller
    setIsRunning(true)
    setLoadError('')
    const start = performance.now()
    try {
      const outcome = await interpretConservatively(prompt, context, interpreter, controller.signal)
      setDeterministicResult({
        elapsedMs: performance.now() - start,
        source: 'Interprete deterministico, primo passaggio',
        output: summarizeInterpretation(outcome.deterministic),
      })
      setLocalResult({
        elapsedMs: performance.now() - start,
        source: outcome.source === 'local-slm' ? 'Modello locale, proposta da confermare' : outcome.source === 'deterministic-fallback' ? 'Fallback deterministico' : 'Nessun SLM necessario',
        output: outcome.source === 'local-slm' ? outcome.result : summarizeInterpretation(outcome.result),
        warning: outcome.source === 'deterministic-fallback' ? outcome.reason : outcome.source === 'deterministic'
          ? outcome.deterministic.ambiguities.length
            ? 'Il parser ha rilevato un’ambiguità e richiede un chiarimento; il modello non è stato invocato.'
            : 'La richiesta era già risolta dal parser; il modello non è stato invocato.'
          : undefined,
      })
      if (outcome.source === 'deterministic-fallback') setModelLoaded(false)
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(formatSLMError(error))
    } finally {
      if (abortController.current === controller) abortController.current = null
      setIsRunning(false)
    }
  }

  function cancelOperation() {
    abortController.current?.abort()
    abortController.current = null
    setIsLoading(false)
    setIsRunning(false)
    setModelLoaded(false)
    setProgress({ status: 'Operazione interrotta. Il modello non è stato applicato.' })
  }

  return (
    <div className="page-stack slm-page">
      <header className="slm-heading">
        <div>
          <p className="eyebrow">ESPERIMENTO LOCALE · NESSUNA MODIFICA SALVATA</p>
          <h1>Benchmark interpreti</h1>
          <p className="intro-copy">Confronto isolato tra interprete deterministico e modello nel browser. Ogni risultato è solo una proposta.</p>
        </div>
        <span className="slm-clock">Orologio test: 24 ott 2026 · Europe/Rome</span>
      </header>

      <section className="slm-controls" aria-label="Richiesta di prova">
        <label htmlFor="slm-prompt">Prompt in italiano</label>
        <textarea id="slm-prompt" rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <div className="slm-actions">
          <button className="button button-outline" type="button" onClick={runDeterministic} disabled={!prompt.trim()}>Esegui deterministico</button>
          {!modelLoaded && <button className="button button-primary" type="button" onClick={loadModel} disabled={isLoading || !capability.supported}>
            {isLoading ? 'Caricamento modello…' : `Scarica e carica modello · ~${Math.round(LOCAL_SLM_MODEL.estimatedModelBytes / 1_000_000)} MB`}
          </button>}
          {modelLoaded && <button className="button button-primary" type="button" onClick={runLocal} disabled={isRunning || !prompt.trim()}>{isRunning ? 'Inferenza in corso…' : 'Esegui modello locale'}</button>}
          {(isLoading || isRunning) && <button className="button button-outline" type="button" onClick={cancelOperation}>Interrompi</button>}
        </div>
        <p className="slm-disclosure">Modello Qwen2.5-0.5B-Instruct, quantizzazione Q4F16. Il primo caricamento richiede una connessione per scaricare circa 483 MB di pesi, oltre ai file tokenizer e runtime. Nessun download parte all’apertura. I file possono restare nella cache del browser, soggetta alle sue politiche di spazio e cancellazione.</p>
        {!capability.supported && <p className="ask-error" role="status">{capability.message} Il test deterministico resta disponibile.</p>}
        {progress && <p className="slm-progress" role="status">{progress.status}{progress.file ? ` · ${progress.file}` : ''}{progress.progress !== undefined ? ` · ${Math.round(progress.progress)}%` : ''}</p>}
        {loadError && <p className="ask-error" role="alert">{loadError} La proposta non è stata applicata; usa l’interprete deterministico.</p>}
      </section>

      <section className="slm-results" aria-label="Risultati a confronto">
        <ResultPanel title="Interprete deterministico" result={deterministicResult} />
        <ResultPanel title="Modello locale" result={localResult} />
      </section>
      <footer className="page-foot"><span>NESSUNA PERSISTENZA · NESSUN CONSIGLIO SUL LIEVITO</span><span>LE PROPOSTE RESTANO IN SOSPESO FINCHÉ NON SONO CONFERMATE</span></footer>
    </div>
  )
}

function formatSLMError(error: unknown): string {
  if (!(error instanceof LocalSLMError)) return error instanceof Error ? error.message : 'Operazione locale non riuscita.'
  const labels = {
    'unsupported-browser': 'Browser non supportato da WebGPU.',
    'insufficient-memory': 'Memoria insufficiente o limite GPU non adatto al modello.',
    'download-failed': 'Download dei pesi o dei file di supporto non riuscito.',
    'initialization-failed': 'Inizializzazione del modello locale non riuscita.',
    'inference-failed': 'Inferenza locale non riuscita.',
  }
  return `${labels[error.code]} ${error.message}`
}

function ResultPanel({ title, result }: { title: string; result: DisplayResult | null }) {
  return (
    <article className="slm-result">
      <header><h2>{title}</h2>{result && <span>{result.source} · {result.elapsedMs.toFixed(1)} ms</span>}</header>
      {result?.warning && <p className="ask-error">Fallback: {result.warning}</p>}
      {result ? <pre>{JSON.stringify(result.output, null, 2)}</pre> : <p className="slm-empty">Nessuna prova eseguita.</p>}
    </article>
  )
}