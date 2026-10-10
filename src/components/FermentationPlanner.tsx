import { AlertTriangle, Check, ChevronDown, ChevronUp, Clock3, Plus, Printer, RotateCcw, Snowflake, Thermometer, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { format } from 'date-fns'
import { FermentationAssistance } from './FermentationAssistance'
import { getFlourGuidance, getTemperatureGuidance } from '../domain/fermentation/guidance'
import { isManualPhase, isWithinAvailableHours, optimizeFermentationSchedule } from '../domain/fermentation/availability'
import type { EstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import {
  addPhase,
  applyStrategyTemplate,
  createPhaseId,
  formatDuration,
  PHASE_LABELS,
  removePhase,
  setScheduleAnchor,
  STRATEGY_LABELS,
  updatePhase,
  updateTotalDuration,
} from '../domain/fermentation/schedule'
import type { FermentationConfig, FermentationPhaseType, FlourGuidanceInput } from '../domain/fermentation/types'
import { validateFermentationSchedule } from '../domain/fermentation/validation'
import type { YeastType } from '../models'

const editableTypes: FermentationPhaseType[] = ['mixing', 'initial-rest', 'bulk-fermentation', 'folding', 'dividing', 'refrigeration', 'final-proof']
const hourlyFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })
const yeastNames: Record<YeastType, string> = { fresh: 'fresco', 'instant-dry': 'secco istantaneo', 'active-dry': 'secco attivo' }

interface FermentationPlannerProps {
  config: FermentationConfig
  onChange: (config: FermentationConfig) => void
  yeastPct: number
  yeastType: YeastType
  flourWeight: number
  guidanceInput: FlourGuidanceInput
  onYeastPctChange: (percentage: number) => void
  onYeastTypeChange: (type: YeastType) => void
  estimatorConfiguration: EstimatorConfiguration
  onEstimatorConfigurationChange: (configuration: EstimatorConfiguration) => void
  hydrationPct: number
  saltPct: number
  doughWeight: number
  otherIngredientPercentages: number
  onPrint: () => void
}

function getIsoForInput(iso: string) {
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm")
}

function tempForEnvironment(config: FermentationConfig, environment: FermentationConfig['phases'][number]['environment']) {
  if (environment === 'ambient') return config.ambientTemperatureC
  if (environment === 'refrigerator') return config.refrigeratorTemperatureC
  if (environment === 'dough') return config.measuredDoughTemperatureC ?? config.ambientTemperatureC
  return config.ambientTemperatureC
}

export function FermentationPlanner({ config, onChange, yeastPct, yeastType, flourWeight, guidanceInput, onYeastPctChange, onYeastTypeChange, estimatorConfiguration, onEstimatorConfigurationChange, hydrationPct, saltPct, doughWeight, otherIngredientPercentages, onPrint }: FermentationPlannerProps) {
  const [showPhases, setShowPhases] = useState(true)
  const [optimizationConflicts, setOptimizationConflicts] = useState<string[]>([])
  const warnings = [
    ...getTemperatureGuidance(config),
    ...getFlourGuidance({ ...guidanceInput, durationMinutes: config.totalDurationMinutes }),
  ]
  const phasesTotal = config.phases.reduce((sum, phase) => sum + phase.durationMinutes, 0)
  const validation = validateFermentationSchedule(config)
  const planValid = config.phases.length > 0 && phasesTotal === config.totalDurationMinutes && config.totalDurationMinutes > 0 && validation.conflicts.length === 0
  const yeastGrams = flourWeight * yeastPct / 100
  const localDurationHours = Math.floor(config.totalDurationMinutes / 60)
  const localDurationMinutes = config.totalDurationMinutes % 60
  const schedulingConflicts = config.availability.avoidRestHours
    ? config.phases.filter((phase) => isManualPhase(phase) && !isWithinAvailableHours(new Date(phase.startAt), new Date(phase.endAt), config.availability))
      .map((phase) => `“${PHASE_LABELS[phase.type]}” ricade nelle ore di riposo.`)
    : []

  function patch(next: Partial<FermentationConfig>) {
    setOptimizationConflicts([])
    onChange({ ...config, ...next, planConfirmed: true })
  }

  function reportScheduleEditError(error: unknown) {
    if (error instanceof RangeError) setOptimizationConflicts([error.message])
  }

  function changeDuration(hours: number, minutes: number) {
    if (hours < 0 || minutes < 0 || minutes >= 60) return
    const total = hours * 60 + minutes
    try { onChange(updateTotalDuration({ ...config, planConfirmed: true }, total)); setOptimizationConflicts([]) } catch (error) { reportScheduleEditError(error) }
  }

  function changeAnchorDate(value: string) {
    try { onChange(setScheduleAnchor(config, config.timeAnchor, value)); setOptimizationConflicts([]) } catch (error) { reportScheduleEditError(error) }
  }

  function optimizeSchedule() {
    const result = optimizeFermentationSchedule(config)
    if (!result.ok || !result.config) {
      setOptimizationConflicts(result.conflicts)
      return
    }
    setOptimizationConflicts([])
    onChange({ ...result.config, planConfirmed: true })
  }

  function applyGeneratedPlan(candidate: FermentationConfig) {
    const result = optimizeFermentationSchedule(candidate)
    if (!result.ok || !result.config) {
      setOptimizationConflicts(result.conflicts)
      return
    }
    setOptimizationConflicts([])
    onChange({ ...result.config, planConfirmed: true })
  }

  function changePhase(phaseId: string, changes: Parameters<typeof updatePhase>[2]) {
    try { onChange(updatePhase(config, phaseId, changes)); setOptimizationConflicts([]) } catch (error) { reportScheduleEditError(error) }
  }

  function suggestMoreTime(extraMinutes: number) {
    try {
      const proposed = updateTotalDuration({ ...config, planConfirmed: true }, config.totalDurationMinutes + extraMinutes)
      const start = new Date(proposed.plannedStartAt).toLocaleString('it-IT')
      const bake = new Date(proposed.bakingAt).toLocaleString('it-IT')
      if (!window.confirm(`La preparazione inizierebbe ${extraMinutes} minuti prima (${start}); la cottura resterebbe alle ${bake}. La dose di lievito resta invariata. Applicare la proposta?`)) return
      onChange(proposed)
      setOptimizationConflicts([])
    } catch (error) { reportScheduleEditError(error) }
  }

  function suggestRoomTemperature() {
    let proposed: FermentationConfig
    try { proposed = applyStrategyTemplate({ ...config, strategy: 'room-temperature' }, 'room-temperature') } catch (error) { reportScheduleEditError(error); return }
    if (!window.confirm('La proposta sostituisce le fasi con un modello a temperatura ambiente e conserva l’orario di cottura. Rivedi le durate prima di confermare; la dose di lievito resta invariata. Applicare?')) return
    onChange({ ...proposed, planConfirmed: false })
    setOptimizationConflicts([])
  }

  function applyTemplate() {
    if (config.planConfirmed && !window.confirm('Applicare il modello sostituirà le fasi e le relative durate attuali. Vuoi continuare?')) return
    try { applyGeneratedPlan(applyStrategyTemplate(config, config.strategy)) } catch (error) {
      reportScheduleEditError(error)
    }
  }

  function changeStrategy(strategy: FermentationConfig['strategy']) {
    if (strategy === config.strategy) return
    if (config.planConfirmed && !window.confirm('Cambiare strategia sostituirà le fasi attuali con un nuovo modello. Vuoi continuare?')) return
    try { applyGeneratedPlan(applyStrategyTemplate({ ...config, strategy }, strategy)) } catch (error) {
      reportScheduleEditError(error)
    }
  }

  function addNewPhase() {
    const type = editableTypes.find((candidate) => candidate === 'folding' && !config.phases.some((phase) => phase.type === 'folding'))
      ?? editableTypes.find((candidate) => candidate !== 'mixing' && candidate !== 'dividing')
      ?? 'folding'
    const environment = type === 'refrigeration' ? 'refrigerator' : 'ambient'
    const phase = {
      id: createPhaseId(),
      type,
      durationMinutes: 30,
      startAt: '',
      endAt: '',
      environment,
      temperatureC: tempForEnvironment(config, environment),
      notes: '',
    } satisfies FermentationConfig['phases'][number]
    try { onChange(addPhase(config, phase)); setOptimizationConflicts([]) } catch (error) { reportScheduleEditError(error) }
  }

  function removeExistingPhase(id: string) {
    try { onChange(removePhase(config, id)); setOptimizationConflicts([]) } catch (error) { reportScheduleEditError(error) }
  }

  function changeYeastUnit(unit: FermentationConfig['manualYeastUnit']) {
    patch({ manualYeastUnit: unit })
  }

  function changeYeastAmount(value: string) {
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount < 0 || flourWeight <= 0) return
    onYeastPctChange(config.manualYeastUnit === 'grams' ? amount / flourWeight * 100 : amount)
    patch({})
  }

  const yeastValue = config.manualYeastUnit === 'grams' ? yeastGrams : yeastPct
  return (
    <section className="form-section fermentation-editor" aria-labelledby="fermentation-title">
      <div className="form-section-heading"><span className="step-index">05</span><div><h2 id="fermentation-title">Lievitazione assistita</h2><p>Pianifica le fasi e confronta condizioni e tempi senza confondere la stima termica con una previsione biologica.</p></div></div>
      {!config.planConfirmed && <div className="plan-status incomplete"><AlertTriangle size={15} /><span>Piano iniziale da verificare e confermare</span></div>}
      {config.planConfirmed && <div className={`plan-status ${planValid ? 'complete' : 'incomplete'}`} role={planValid ? 'status' : 'alert'}>{planValid ? <Check size={15} /> : <AlertTriangle size={15} />}<span>{validation.status}</span></div>}
      {validation.conflicts.length > 0 && <div className="scheduling-conflict" role="alert"><strong>Conflitti del piano</strong>{validation.conflicts.map((conflict) => <p key={conflict}>{conflict}</p>)}</div>}
      {validation.uncertainty.map((item) => <p className="temperature-help" key={item}>{item}</p>)}

      <div className="fermentation-subsection"><div className="subsection-title"><Clock3 size={15} /><h3>Quando vuoi infornare?</h3></div>
        <div className="field-row time-anchor-switch"><div className="segmented-control"><button className={config.timeAnchor === 'bake' ? 'selected' : ''} type="button" onClick={() => patch({ timeAnchor: 'bake' })}>Orario di cottura</button><button className={config.timeAnchor === 'start' ? 'selected' : ''} type="button" onClick={() => patch({ timeAnchor: 'start' })}>Inizio impasto</button></div></div>
        <label className="field datetime-field"><span>{config.timeAnchor === 'bake' ? 'Data e ora di cottura desiderate' : 'Data e ora di inizio preparazione'}</span><input type="datetime-local" value={getIsoForInput(config.timeAnchor === 'bake' ? config.bakingAt : config.plannedStartAt)} onChange={(event) => changeAnchorDate(event.target.value)} /></label>
        <div className="duration-edit"><span className="field-label">Tempo totale disponibile</span><div className="duration-inputs"><label className="input-with-unit"><input aria-label="Durata totale in ore" type="number" min="0" step="1" value={localDurationHours} onChange={(event) => changeDuration(Number(event.target.value), localDurationMinutes)} /><small>ore</small></label><label className="input-with-unit"><input aria-label="Durata totale in minuti" type="number" min="0" max="59" step="1" value={localDurationMinutes} onChange={(event) => changeDuration(localDurationHours, Number(event.target.value))} /><small>min</small></label><strong>{formatDuration(config.totalDurationMinutes)}</strong></div></div>
      </div>

      <div className="fermentation-subsection availability-section"><div className="subsection-title"><Clock3 size={15} /><h3>Quando puoi lavorare l’impasto?</h3></div>
        <label className="check-line availability-toggle"><input type="checkbox" checked={config.availability.avoidRestHours} onChange={(event) => patch({ availability: { ...config.availability, avoidRestHours: event.target.checked } })} /><span>Evita operazioni durante le ore di riposo</span></label>
        <div className="availability-hours">
          <label className="field"><span>Dalle</span><input type="time" value={config.availability.unavailableStart} disabled={!config.availability.avoidRestHours} onChange={(event) => patch({ availability: { ...config.availability, unavailableStart: event.target.value } })} /></label>
          <label className="field"><span>Alle</span><input type="time" value={config.availability.unavailableEnd} disabled={!config.availability.avoidRestHours} onChange={(event) => patch({ availability: { ...config.availability, unavailableEnd: event.target.value } })} /></label>
          <p>Intervallo predefinito 23:00–08:00; sono supportati gli intervalli che attraversano la mezzanotte.</p>
        </div>
        {schedulingConflicts.length > 0 && <div className="scheduling-conflict" role="status"><strong>Conflitti di orario</strong>{schedulingConflicts.map((conflict) => <p key={conflict}>{conflict}</p>)}</div>}
        <button className="button button-outline optimize-schedule-button" type="button" disabled={!config.availability.avoidRestHours} onClick={optimizeSchedule}>Trova orari pratici</button>
        {optimizationConflicts.length > 0 && <div className="scheduling-conflict" role="alert"><strong>Conflitti di orario</strong>{optimizationConflicts.map((conflict) => <p key={conflict}>{conflict}</p>)}</div>}
        {(optimizationConflicts.length > 0 || validation.conflicts.length > 0) && <div className="practical-suggestions"><strong>Proposte da verificare</strong><p>Ogni modifica mostra prima l’effetto sugli orari. Le proposte temporali conservano la cottura e la dose di lievito.</p><div className="suggestion-actions"><button className="button button-outline" type="button" onClick={() => suggestMoreTime(60)}>Anticipa la preparazione</button><button className="button button-outline" type="button" onClick={() => suggestMoreTime(120)}>Aumenta il tempo disponibile</button><button className="button button-outline" type="button" onClick={suggestRoomTemperature}>Modifica la strategia</button><button className="button button-outline" type="button" onClick={() => { setShowPhases(true); document.querySelector('.phase-edit-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>Rivedi le fasi opzionali</button></div></div>}
      </div>

      <div className="fermentation-subsection"><div className="subsection-title"><Thermometer size={15} /><h3>Temperature rilevate o impostate</h3></div>
        <div className="temperature-grid"><label className="field"><span>Ambiente</span><div className="input-with-unit"><input aria-label="Temperatura ambiente" type="number" min="-10" max="45" step="0.5" value={config.ambientTemperatureC} onChange={(event) => { const value = Number(event.target.value); if (!Number.isFinite(value)) return; patch({ ambientTemperatureC: value, phases: config.phases.map((phase) => phase.environment === 'ambient' ? { ...phase, temperatureC: value } : phase) }) }} /><small>°C</small></div></label><label className="field"><span>Impasto misurato all’avvio <small>facoltativa</small></span><div className="input-with-unit"><input aria-label="Temperatura iniziale impasto misurata" type="number" min="0" max="40" step="0.5" value={config.measuredDoughTemperatureC ?? ''} placeholder="—" onChange={(event) => patch({ measuredDoughTemperatureC: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>°C</small></div></label><label className="field"><span>Frigorifero</span><div className="input-with-unit"><input aria-label="Temperatura frigorifero" type="number" min="-5" max="20" step="0.5" value={config.refrigeratorTemperatureC} onChange={(event) => { const value = Number(event.target.value); if (!Number.isFinite(value)) return; patch({ refrigeratorTemperatureC: value, phases: config.phases.map((phase) => phase.environment === 'refrigerator' ? { ...phase, temperatureC: value } : phase) }) }} /><small>°C</small></div></label><label className="field"><span>Temperatura finale obiettivo <small>facoltativa</small></span><div className="input-with-unit"><input aria-label="Temperatura finale obiettivo" type="number" min="0" max="40" step="0.5" value={config.targetDoughTemperatureC ?? ''} placeholder="—" onChange={(event) => patch({ targetDoughTemperatureC: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>°C</small></div></label></div>
        <p className="temperature-help"><Thermometer size={12} /> Ambiente, frigorifero e impasto sono distinti. La misura dell’impasto è l’ancoraggio iniziale del profilo.</p>
      </div>

      <div className="fermentation-subsection"><div className="subsection-title"><Snowflake size={15} /><h3>Strategia di fermentazione</h3></div>
        <div className="strategy-controls"><label className="field"><span>Strategia</span><select aria-label="Strategia di fermentazione" value={config.strategy} onChange={(event) => changeStrategy(event.target.value as FermentationConfig['strategy'])}>{Object.entries(STRATEGY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button type="button" className="button button-outline template-button" onClick={applyTemplate}><RotateCcw size={14} /> Applica modello</button></div>
        <p className="strategy-explanation">{config.strategy === 'refrigerated' || config.strategy === 'combined' ? 'Il freddo rallenta l’attività fermentativa, ma non la interrompe.' : config.strategy === 'room-temperature' ? 'Le fasi fermentative si svolgono all’ambiente impostato.' : 'Personalizza fasi, durate e temperature in autonomia.'} I modelli sono punti di partenza, non prescrizioni universali.</p>
      </div>

      <div className="fermentation-subsection phases-editor"><div className="subsection-title phase-heading"><div><Clock3 size={15} /><h3>Fasi del piano</h3><span className="phase-count">{config.phases.length}</span></div><button className="icon-button" type="button" aria-label={showPhases ? 'Comprimi fasi' : 'Espandi fasi'} onClick={() => setShowPhases(!showPhases)}>{showPhases ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button></div>
        {showPhases && <div className="phase-edit-list">{config.phases.map((phase, index) => {
          const hours = Math.floor(phase.durationMinutes / 60)
          const minutes = phase.durationMinutes % 60
          return <article className="phase-edit-card" key={phase.id}><div className="phase-edit-top"><span className="phase-order">{String(index + 1).padStart(2, '0')}</span><label className="field phase-type-field"><span>Tipo di fase</span><select value={phase.type} onChange={(event) => changePhase(phase.id, { type: event.target.value as FermentationPhaseType, environment: event.target.value === 'refrigeration' ? 'refrigerator' : phase.environment, temperatureC: event.target.value === 'refrigeration' ? config.refrigeratorTemperatureC : phase.temperatureC })}>{editableTypes.map((type) => <option value={type} key={type}>{PHASE_LABELS[type]}</option>)}</select></label><button className="icon-button danger-icon" type="button" aria-label={`Rimuovi fase ${PHASE_LABELS[phase.type]}`} title="Rimuovi fase" onClick={() => removeExistingPhase(phase.id)}><Trash2 size={15} /></button></div>
            <div className="phase-edit-fields"><div className="phase-duration-control"><span>Durata</span><div className="phase-duration-inputs"><label><input type="number" min="0" step="1" aria-label={`Ore fase ${index + 1}`} value={hours} onChange={(event) => changePhase(phase.id, { durationMinutes: Number(event.target.value) * 60 + minutes })} /><small>ore</small></label><label><input type="number" min="0" max="59" step="1" aria-label={`Minuti fase ${index + 1}`} value={minutes} onChange={(event) => changePhase(phase.id, { durationMinutes: hours * 60 + Number(event.target.value) })} /><small>min</small></label></div></div><label className="field phase-environment-field"><span>Ambiente della fase</span><select value={phase.environment} onChange={(event) => { const environment = event.target.value as typeof phase.environment; changePhase(phase.id, { environment, temperatureC: tempForEnvironment(config, environment) }) }}><option value="ambient">Ambiente</option><option value="refrigerator">Frigorifero</option><option value="dough">Temperatura impasto</option><option value="custom">Personalizzata</option></select></label><label className="field phase-temp-field"><span>Temperatura ambiente fase</span><div className="input-with-unit"><input type="number" step="0.5" aria-label={`Temperatura ambiente fase ${index + 1}`} value={phase.temperatureC} onChange={(event) => changePhase(phase.id, { temperatureC: Number(event.target.value) })} /><small>°C</small></div></label></div>
            <label className="field phase-measured-temp"><span>Impasto misurato all’inizio della fase <small>facoltativa</small></span><div className="input-with-unit"><input type="number" min="-10" max="50" step="0.5" aria-label={`Temperatura impasto misurata fase ${index + 1}`} value={phase.measuredDoughTemperatureC ?? ''} placeholder="—" onChange={(event) => changePhase(phase.id, { measuredDoughTemperatureC: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>°C</small></div></label>
            {isManualPhase(phase) && <label className="check-line phase-lock"><input type="checkbox" checked={phase.boundaryLocked === true} onChange={(event) => changePhase(phase.id, { boundaryLocked: event.target.checked })} /><span>Blocca l’orario di questa operazione</span></label>}
            <details className="phase-duration-limits"><summary>Opzioni avanzate e limiti facoltativi</summary><label className="check-line"><input type="checkbox" checked={phase.optional === true} onChange={(event) => changePhase(phase.id, { optional: event.target.checked, skipped: false, durationMinutes: phase.skipped ? 30 : phase.durationMinutes })} /><span>Fase facoltativa</span></label>{phase.optional && <><label className="check-line"><input type="checkbox" checked={phase.skipped === true} onChange={(event) => changePhase(phase.id, { optional: true, skipped: event.target.checked, durationMinutes: event.target.checked ? 0 : 30 })} /><span>Salta esplicitamente questa fase</span></label><small>La durata totale diminuisce; con cottura fissata, la preparazione inizierà più tardi.</small></>}{!isManualPhase(phase) && <div><label className="field"><span>Minimo, minuti</span><input type="number" min="0" value={phase.minimumDurationMinutes ?? ''} onChange={(event) => changePhase(phase.id, { minimumDurationMinutes: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label className="field"><span>Massimo, minuti</span><input type="number" min="0" value={phase.maximumDurationMinutes ?? ''} onChange={(event) => changePhase(phase.id, { maximumDurationMinutes: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></div>}</details>
            <label className="field phase-notes-field"><span>Note</span><textarea rows={2} value={phase.notes} placeholder="Aggiungi una nota alla fase" onChange={(event) => changePhase(phase.id, { notes: event.target.value })} /></label>
            <p className="phase-time-caption">{formatDuration(phase.durationMinutes)} · {new Date(phase.startAt).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} – {new Date(phase.endAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>
          </article>
        })}<button className="text-link add-phase-button" type="button" onClick={addNewPhase}><Plus size={15} /> Aggiungi una fase (30 min)</button></div>}
        <div className={`phase-total${planValid ? ' valid' : ' invalid'}`}><span>Somma delle fasi</span><strong>{formatDuration(phasesTotal)}</strong><span>{planValid ? 'Coerente con la finestra disponibile' : `Durata piano: ${hourlyFormatter.format(config.totalDurationMinutes / 60)} ore`}</span></div>
      </div>

      <div className="fermentation-subsection yeast-subsection"><div className="subsection-title"><span className="yeast-dot">Y</span><h3>Gestione del lievito</h3></div>
        <div className="yeast-mode-toggle"><button type="button" className={config.yeastMode === 'manual' ? 'selected' : ''} onClick={() => patch({ yeastMode: 'manual' })}>Manuale</button><button type="button" className={config.yeastMode === 'assisted' ? 'selected' : ''} onClick={() => patch({ yeastMode: 'assisted' })}>Assistita</button></div>
        <label className="field yeast-type-field"><span>Tipo di lievito</span><select value={yeastType} onChange={(event) => { const type = event.target.value as YeastType; onYeastTypeChange(type); patch({ yeastType: type }) }}><option value="fresh">Lievito fresco</option><option value="instant-dry">Lievito secco istantaneo</option><option value="active-dry">Lievito secco attivo</option></select></label>
        <div className="manual-dose-row"><label className="field"><span>Inserisci la dose in</span><select value={config.manualYeastUnit} onChange={(event) => changeYeastUnit(event.target.value as FermentationConfig['manualYeastUnit'])}><option value="percentage">Percentuale sulla farina</option><option value="grams">Grammi</option></select></label><label className="field"><span>{config.yeastMode === 'assisted' ? 'Dose scelta da te' : 'Dose di lievito'}</span><div className="input-with-unit"><input type="number" min="0" step={config.manualYeastUnit === 'grams' ? '0.01' : '0.001'} value={Number.isFinite(yeastValue) ? Number(yeastValue.toFixed(3)) : ''} onChange={(event) => changeYeastAmount(event.target.value)} /><small>{config.manualYeastUnit === 'grams' ? 'g' : '%'}</small></div></label></div><p className="yeast-integrity">Dose attuale: {yeastGrams.toLocaleString('it-IT', { maximumFractionDigits: 3 })} g di lievito {yeastNames[yeastType]}. {config.yeastMode === 'assisted' ? 'Nessuna raccomandazione numerica è disponibile: questa dose resta una tua scelta manuale.' : 'Il calcolo dell’impasto si aggiorna mantenendo il bilancio di massa.'}</p>
      </div>

      <FermentationAssistance
        config={config}
        yeastGrams={yeastGrams}
        yeastPct={yeastPct}
        yeastType={yeastType}
        flourWeight={flourWeight}
        doughWeight={doughWeight}
        otherIngredientPercentages={otherIngredientPercentages}
        hydrationPct={hydrationPct}
        saltPct={saltPct}
        guidanceInput={guidanceInput}
        estimatorConfiguration={estimatorConfiguration}
        onConfigChange={onChange}
        onEstimatorConfigurationChange={onEstimatorConfigurationChange}
        onYeastPctChange={onYeastPctChange}
        onYeastTypeChange={onYeastTypeChange}
      />

      {warnings.some(({ basis }) => basis === 'dati farina inseriti') && <div className="fermentation-warnings warning-technical"><div className="subsection-title"><AlertTriangle size={15} /><h3>Dati tecnici mancanti o da verificare</h3></div>{warnings.filter(({ basis }) => basis === 'dati farina inseriti').map((warning) => <p key={warning.code}>{warning.message}</p>)}</div>}
      {warnings.some(({ basis }) => basis === 'orientamento generale') && <div className="fermentation-warnings warning-empirical"><div className="subsection-title"><AlertTriangle size={15} /><h3>Incertezza fermentativa</h3></div>{warnings.filter(({ basis }) => basis === 'orientamento generale').map((warning) => <p key={warning.code}>{warning.message}</p>)}</div>}
      {warnings.some(({ basis }) => basis === 'temperatura inserita') && <div className="fermentation-warnings warning-technical"><div className="subsection-title"><AlertTriangle size={15} /><h3>Verifica delle temperature inserite</h3></div>{warnings.filter(({ basis }) => basis === 'temperatura inserita').map((warning) => <p key={warning.code}>{warning.message}</p>)}</div>}
      <div className="fermentation-actions"><button className="button button-outline" type="button" onClick={onPrint}><Printer size={15} /> Stampa ricetta e piano</button></div>
    </section>
  )
}