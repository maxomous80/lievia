import { useState, type FormEvent } from 'react'
import { calculateTemperatureProfile } from '../domain/fermentation/temperatureProfile'
import {
  buildThermalCalibrationDataset,
  compareTemperatureSamples,
  fitThermalTimeConstant,
  validateTemperatureSamples,
  type TemperatureMeasurementSample,
  type ThermalCalibrationRun,
} from '../domain/fermentation/thermalCalibration'
import type { FermentationConfig } from '../domain/fermentation/types'
import type { EstimatorConfiguration } from '../domain/fermentation/modelConfiguration'

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: digits }).format(value)
}

function environmentForPhase(config: FermentationConfig, phase: FermentationConfig['phases'][number]) {
  if (phase.environment === 'ambient') return config.ambientTemperatureC
  if (phase.environment === 'refrigerator') return config.refrigeratorTemperatureC
  if (phase.environment === 'custom') return phase.temperatureC
  return null
}

function fitFromSamples(config: FermentationConfig, samples: TemperatureMeasurementSample[]) {
  const runs: ThermalCalibrationRun[] = config.phases.flatMap((phase, index) => {
    const phaseSamples = samples.filter(({ phaseId }) => phaseId === phase.id)
    const environmentTemperatureC = environmentForPhase(config, phase)
    const initialTemperatureC = phase.measuredDoughTemperatureC ?? (index === 0 ? config.measuredDoughTemperatureC : undefined)
    if (!phaseSamples.length || environmentTemperatureC === null || initialTemperatureC === undefined) return []
    return [{
      id: `phase-${phase.id}`,
      startedAt: phase.startAt,
      initialTemperatureC,
      environmentTemperatureC,
      environmentSource: phase.environment === 'ambient' ? 'Temperatura ambiente configurata' : phase.environment === 'refrigerator' ? 'Temperatura frigorifero configurata' : 'Temperatura fase personalizzata configurata',
      samples: phaseSamples,
      provenance: 'Misure inserite manualmente; condizioni costanti dichiarate per la fase.',
    }]
  })
  try { return fitThermalTimeConstant(buildThermalCalibrationDataset(runs)) }
  catch (error) {
    return { status: 'unavailable' as const, timeConstantMinutes: null, calibrationSampleCount: 0, validationSampleCount: 0, calibrationMetrics: null, validationMetrics: null, warnings: [error instanceof Error ? error.message : 'Dati di calibrazione non validi.'] }
  }
}

export function ThermalAnalysis({
  config,
  samples,
  estimatorConfiguration,
  onEstimatorConfigurationChange,
  onAddSample,
  onRemoveSample,
  compact = false,
  comparisonConfig,
}: {
  config: FermentationConfig
  samples: TemperatureMeasurementSample[]
  estimatorConfiguration: EstimatorConfiguration
  onEstimatorConfigurationChange?: (configuration: EstimatorConfiguration) => void
  onAddSample?: (sample: TemperatureMeasurementSample) => void
  onRemoveSample?: (id: string) => void
  compact?: boolean
  comparisonConfig?: FermentationConfig
}) {
  const [at, setAt] = useState(localDateTimeValue())
  const [temperature, setTemperature] = useState('')
  const [source, setSource] = useState('Termometro manuale')
  const [sensorId, setSensorId] = useState('')
  const [uncertainty, setUncertainty] = useState('')
  const [note, setNote] = useState('')
  const [phaseId, setPhaseId] = useState(config.phases[0]?.id ?? '')
  const [split, setSplit] = useState<TemperatureMeasurementSample['split']>('validation')
  const [inputError, setInputError] = useState('')
  const [calibrationVisible, setCalibrationVisible] = useState(false)
  const parameters = {
    timeConstantMinutes: estimatorConfiguration.thermalTimeConstantMinutes,
    initialDoughTemperatureC: estimatorConfiguration.estimatedInitialDoughTemperatureC,
    timeConstantProvenance: estimatorConfiguration.thermalTimeConstantProvenance,
    modelVersion: 'thermal-first-order-v2',
  }
  const profile = calculateTemperatureProfile(config, parameters)
  const comparisonProfile = comparisonConfig ? calculateTemperatureProfile(comparisonConfig, parameters) : null
  const validSamples = samples.filter((sample) => validateTemperatureSamples([sample]).valid)
  const independentSamples = validSamples.filter(({ split: role }) => role === 'validation')
  const comparison = compareTemperatureSamples(profile, independentSamples)
  const fit = fitFromSamples(config, samples)
  const finitePoints = profile.points.filter(({ doughTemperatureC }) => doughTemperatureC !== null)
  const values = finitePoints.map(({ doughTemperatureC }) => doughTemperatureC!)
  const minTemp = values.length ? Math.min(...values, ...validSamples.map(({ temperatureC }) => temperatureC)) - 1 : -10
  const maxTemp = values.length ? Math.max(...values, ...validSamples.map(({ temperatureC }) => temperatureC)) + 1 : 50
  const allProfilePoints = [...finitePoints, ...(comparisonProfile?.points.filter(({ doughTemperatureC }) => doughTemperatureC !== null) ?? [])]
  const plottedTimes = [...allProfilePoints.map(({ at }) => Date.parse(at)), ...validSamples.map(({ at: timestamp }) => Date.parse(timestamp))]
  const minTime = plottedTimes.length ? Math.min(...plottedTimes) : 0
  const maxTime = plottedTimes.length ? Math.max(...plottedTimes) : minTime + 1
  const y = (temperatureC: number) => 148 - (temperatureC - minTemp) / Math.max(maxTemp - minTemp, 0.1) * 128
  const x = (timestamp: string) => 24 + (Date.parse(timestamp) - minTime) / Math.max(maxTime - minTime, 1) * 552
  const curve = finitePoints.map((point, index) => `${index ? 'L' : 'M'} ${x(point.at).toFixed(2)} ${y(point.doughTemperatureC!).toFixed(2)}`).join(' ')
  const comparisonPoints = comparisonProfile?.points.filter(({ doughTemperatureC }) => doughTemperatureC !== null) ?? []
  const comparisonCurve = comparisonPoints.map((point, index) => `${index ? 'L' : 'M'} ${x(point.at).toFixed(2)} ${y(point.doughTemperatureC!).toFixed(2)}`).join(' ')

  function addMeasurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInputError('')
    if (!onAddSample) return
    const date = new Date(at)
    const sample: TemperatureMeasurementSample = {
      id: crypto.randomUUID(),
      phaseId: phaseId || undefined,
      at: Number.isFinite(date.getTime()) ? date.toISOString() : '',
      temperatureC: Number(temperature),
      unit: 'C',
      source: source.trim(),
      sensorId: sensorId.trim() || undefined,
      uncertaintyC: uncertainty === '' ? undefined : Number(uncertainty),
      note: note.trim() || undefined,
      split,
    }
    const validation = validateTemperatureSamples([...samples, sample])
    if (!validation.valid) {
      setInputError(validation.errors.join(' '))
      return
    }
    onAddSample(sample)
    setTemperature('')
    setUncertainty('')
    setNote('')
    setAt(localDateTimeValue())
  }

  function useFittedTau() {
    if (!onEstimatorConfigurationChange || fit.status !== 'estimated' || fit.timeConstantMinutes === null) return
    onEstimatorConfigurationChange({
      ...estimatorConfiguration,
      thermalTimeConstantMinutes: fit.timeConstantMinutes,
      thermalTimeConstantProvenance: `Stima su ${fit.calibrationSampleCount} misure reali; ${fit.validationSampleCount} campioni indipendenti non usati nel fitting. Non validata sperimentalmente.`,
    })
  }

  return <details className={`thermal-analysis${compact ? ' thermal-analysis-compact' : ''}`}>
    <summary>Analisi termica dell’impasto</summary>
    <div className="thermal-analysis-body">
      <p className="thermal-disclaimer">Modello termico semplificato di primo ordine. Una curva stimata non è una misura né una validazione sperimentale; non predice maturazione o qualità della pizza.</p>
      <div className="thermal-meta-grid">
        <span><small>Impasto iniziale</small><strong>{config.measuredDoughTemperatureC === undefined ? estimatorConfiguration.estimatedInitialDoughTemperatureC === undefined ? 'Non indicata' : `${formatNumber(estimatorConfiguration.estimatedInitialDoughTemperatureC)} °C · ipotesi` : `${formatNumber(config.measuredDoughTemperatureC)} °C · misurata`}</strong></span>
        <span><small>Ambiente / frigorifero</small><strong>{formatNumber(config.ambientTemperatureC)} / {formatNumber(config.refrigeratorTemperatureC)} °C</strong></span>
        <span><small>Costante termica τ</small><strong>{parameters.timeConstantMinutes === undefined ? 'Non impostata' : `${formatNumber(parameters.timeConstantMinutes)} min`}</strong></span>
        <span><small>Modello</small><strong>{parameters.modelVersion}</strong></span>
      </div>
      {onEstimatorConfigurationChange && <div className="thermal-parameter-fields">
        <label className="field"><span>Costante termica configurabile · τ</span><div className="input-with-unit"><input type="number" min="0.1" step="1" value={estimatorConfiguration.thermalTimeConstantMinutes ?? ''} placeholder="Non impostata" onChange={(event) => onEstimatorConfigurationChange({ ...estimatorConfiguration, thermalTimeConstantMinutes: event.target.value === '' ? undefined : Number(event.target.value), thermalTimeConstantProvenance: event.target.value === '' ? undefined : 'Valore inserito manualmente dall’utente; non validato sperimentalmente.' })} /><small>min</small></div></label>
        <label className="field"><span>Temperatura iniziale ipotizzata</span><div className="input-with-unit"><input type="number" min="-10" max="50" step="0.1" value={estimatorConfiguration.estimatedInitialDoughTemperatureC ?? ''} placeholder="Non indicata" onChange={(event) => onEstimatorConfigurationChange({ ...estimatorConfiguration, estimatedInitialDoughTemperatureC: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>°C</small></div></label>
        {estimatorConfiguration.thermalTimeConstantProvenance && <small className="thermal-provenance">Provenienza τ: {estimatorConfiguration.thermalTimeConstantProvenance}</small>}
      </div>}
      <div className="thermal-chart-wrap" role="img" aria-label="Grafico della stima della temperatura dell’impasto con misure distinte">
        {curve ? <svg className="thermal-chart" viewBox="0 0 600 170" preserveAspectRatio="none"><path d={curve} fill="none" stroke="var(--terracotta-dark)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />{comparisonCurve && <path d={comparisonCurve} fill="none" stroke="var(--sage-dark)" strokeDasharray="6 4" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}{validSamples.map((sample) => <circle key={sample.id} cx={x(sample.at)} cy={y(sample.temperatureC)} r="4" fill={sample.split === 'validation' ? 'var(--sage-dark)' : '#b48b46'} stroke="white" strokeWidth="1.5" vectorEffect="non-scaling-stroke"><title>{sample.split === 'validation' ? 'Misura indipendente di verifica' : 'Misura assegnata alla calibrazione'}: {formatNumber(sample.temperatureC)} °C</title></circle>)}</svg> : <p className="thermal-empty">Curva non disponibile: inserisci una temperatura iniziale misurata o ipotizzata e τ.</p>}
      </div>
      <div className="thermal-legend"><span><i className="thermal-line" /> {comparisonConfig ? 'Scenario alternativo · stima' : 'Stima del modello'}</span>{comparisonCurve && <span><i className="thermal-line thermal-line-baseline" /> Riferimento · stima</span>}<span><i className="thermal-dot thermal-dot-calibration" /> Campione calibrazione</span><span><i className="thermal-dot" /> Misura indipendente</span></div>
      <p className="thermal-status">Stato: {profile.status === 'estimated' ? 'stima non calibrata' : 'dati insufficienti'} · {profile.explanation}</p>
      {comparison && <div className="thermal-metrics"><strong>Confronto su {comparison.count} misure indipendenti</strong><span>MAE {formatNumber(comparison.maeC, 2)} °C</span><span>RMSE {formatNumber(comparison.rmseC, 2)} °C</span></div>}
      <details className="thermal-calibration-details" open={calibrationVisible} onToggle={(event) => setCalibrationVisible(event.currentTarget.open)}><summary>Preparazione calibrazione</summary><p>Per stimare τ servono almeno quattro misure nella stessa fase a temperatura ambiente costante e una temperatura iniziale misurata. Le misure “Verifica indipendente” non entrano nel fitting.</p><div className="thermal-calibration-status">{fit.status === 'estimated' ? `Stima numerica disponibile: τ ${formatNumber(fit.timeConstantMinutes!)} min · ${fit.calibrationSampleCount} campioni di calibrazione · ${fit.validationSampleCount} di verifica.` : `Stima non disponibile · ${fit.warnings.join(' ')}`}</div>{fit.calibrationMetrics && <p>Residui di calibrazione: MAE {formatNumber(fit.calibrationMetrics.maeC, 2)} °C · RMSE {formatNumber(fit.calibrationMetrics.rmseC, 2)} °C. Questi valori non costituiscono validazione indipendente.</p>}{fit.validationMetrics && <p>Verifica separata: MAE {formatNumber(fit.validationMetrics.maeC, 2)} °C · RMSE {formatNumber(fit.validationMetrics.rmseC, 2)} °C.</p>}{fit.status === 'estimated' && onEstimatorConfigurationChange && <button type="button" className="button button-outline" onClick={useFittedTau}>Usa τ stimata in questa configurazione</button>}</details>
      {onAddSample && <form className="thermal-sample-form" onSubmit={addMeasurement}>
        <h4>Inserisci una misura reale</h4>
        <label className="field"><span>Data e ora</span><input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} required /></label>
        <label className="field"><span>Temperatura misurata</span><div className="input-with-unit"><input type="number" min="-10" max="50" step="0.1" value={temperature} onChange={(event) => setTemperature(event.target.value)} required /><small>°C</small></div></label>
        <label className="field"><span>Sorgente della misura</span><input value={source} onChange={(event) => setSource(event.target.value)} required /></label>
        <label className="field"><span>Sensore · facoltativo</span><input value={sensorId} onChange={(event) => setSensorId(event.target.value)} /></label>
        <label className="field"><span>Accuratezza dichiarata · facoltativa</span><div className="input-with-unit"><input type="number" min="0" max="10" step="0.1" value={uncertainty} onChange={(event) => setUncertainty(event.target.value)} /><small>± °C</small></div></label>
        <label className="field"><span>Fase associata</span><select value={phaseId} onChange={(event) => setPhaseId(event.target.value)}><option value="">Nessuna fase</option>{config.phases.map((phase) => <option value={phase.id} key={phase.id}>{phase.type}</option>)}</select></label>
        <label className="field"><span>Uso del campione</span><select value={split} onChange={(event) => setSplit(event.target.value as TemperatureMeasurementSample['split'])}><option value="validation">Verifica indipendente</option><option value="calibration">Calibrazione · non indipendente</option></select></label>
        <label className="field thermal-note-field"><span>Nota · facoltativa</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {inputError && <p className="form-error thermal-form-error" role="alert">{inputError}</p>}
        <button type="submit" className="button button-outline">Registra misura</button>
      </form>}
      {validSamples.length > 0 && <div className="thermal-sample-list"><h4>Misure salvate sul dispositivo · {validSamples.length}</h4>{validSamples.map((sample) => <div className="thermal-sample-row" key={sample.id}><span><strong>{formatNumber(sample.temperatureC)} °C</strong><small>{new Date(sample.at).toLocaleString('it-IT')} · {sample.source} · {sample.split === 'validation' ? 'verifica indipendente' : 'calibrazione'}</small>{sample.note && <small>{sample.note}</small>}</span>{onRemoveSample && <button type="button" className="icon-button" aria-label="Rimuovi misura" onClick={() => onRemoveSample(sample.id)}>×</button>}</div>)}</div>}
    </div>
  </details>
}
