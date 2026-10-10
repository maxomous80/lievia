import { AlertTriangle, Snowflake, Thermometer } from 'lucide-react'
import { useState } from 'react'
import { YEAST_ESTIMATOR_MODEL, type EstimatorConfiguration } from '../domain/fermentation/modelConfiguration'
import { estimateFermentationExposure } from '../domain/fermentation/fermentationEstimation'
import { compareFermentationStrategies, type ComparableStrategy } from '../domain/fermentation/strategyComparison'
import { formatDuration, formatItalianDateTime, STRATEGY_LABELS } from '../domain/fermentation/schedule'
import type { FlourGuidanceInput, FermentationConfig } from '../domain/fermentation/types'
import type { YeastType } from '../models'
import { convertYeastDose, yeastPercentageForMassBalance } from '../domain/fermentation/yeast'

const yeastLabels: Record<YeastType, string> = {
  fresh: 'fresco',
  'instant-dry': 'secco istantaneo',
  'active-dry': 'secco attivo',
}

function strategyTemperatureSummary(item: ReturnType<typeof compareFermentationStrategies>[number]) {
  if (!item.config || !item.temperatureProfile) return 'Profilo termico non disponibile.'
  const doughPoints = item.temperatureProfile.points.filter((point) => point.doughTemperatureC !== null)
  if (!doughPoints.length) {
    return `Aria ambiente ${item.config.ambientTemperatureC} °C; frigo ${item.config.refrigeratorTemperatureC} °C. Temperatura dell’impasto non stimata.`
  }
  const first = doughPoints[0]
  const last = doughPoints[doughPoints.length - 1]
  const fridgePoints = doughPoints.filter((point) => point.surroundingEnvironment === 'refrigerator')
  const entry = fridgePoints[0]
  const exit = fridgePoints[fridgePoints.length - 1]
  const label = first.doughTemperatureSource === 'measured' ? 'misurato all’avvio' : 'stimato all’avvio'
  const fridge = entry && exit
    ? `; ingresso frigo ${entry.doughTemperatureC} °C, uscita ${exit.doughTemperatureC} °C`
    : ''
  return `Impasto ${label} ${first.doughTemperatureC} °C${fridge}; stima a fine piano ${last.doughTemperatureC} °C. Non sono misure.`
}

interface FermentationAssistanceProps {
  config: FermentationConfig
  yeastGrams: number
  yeastPct: number
  yeastType: YeastType
  flourWeight: number
  doughWeight: number
  otherIngredientPercentages: number
  hydrationPct: number
  saltPct: number
  guidanceInput: FlourGuidanceInput
  estimatorConfiguration: EstimatorConfiguration
  onConfigChange: (config: FermentationConfig) => void
  onEstimatorConfigurationChange: (config: EstimatorConfiguration) => void
  onYeastPctChange: (percentage: number) => void
  onYeastTypeChange: (type: YeastType) => void
}

export function FermentationAssistance(props: FermentationAssistanceProps) {
  const {
    config, yeastGrams, yeastPct, yeastType, flourWeight, doughWeight, otherIngredientPercentages, hydrationPct, saltPct,
    guidanceInput, estimatorConfiguration, onConfigChange, onEstimatorConfigurationChange,
    onYeastPctChange, onYeastTypeChange,
  } = props
  const [showComparison, setShowComparison] = useState(false)
  const thermalParameters = {
    timeConstantMinutes: estimatorConfiguration.thermalTimeConstantMinutes,
    initialDoughTemperatureC: estimatorConfiguration.estimatedInitialDoughTemperatureC,
  }
  const exposure = estimateFermentationExposure(config, thermalParameters, { type: yeastType, percentageOnFlour: yeastPct })
  const comparison = compareFermentationStrategies(config, thermalParameters, guidanceInput)
  const doughPoints = exposure.temperatureProfile.points.filter((point) => point.doughTemperatureC !== null)
  const firstDough = doughPoints[0]
  const lastDough = doughPoints[doughPoints.length - 1]
  const activeRoomTemperatureMinutes = config.phases.filter((phase) => phase.environment === 'ambient').reduce((total, phase) => total + phase.durationMinutes, 0)
  const activeRefrigeratorMinutes = config.phases.filter((phase) => phase.environment === 'refrigerator').reduce((total, phase) => total + phase.durationMinutes, 0)
  const conversionFactors = {
    freshPerInstantDry: estimatorConfiguration.freshPerInstantDry,
    freshPerActiveDry: estimatorConfiguration.freshPerActiveDry,
  }

  function updateSetting(key: keyof EstimatorConfiguration, rawValue: string) {
    const value = rawValue === '' ? undefined : Number(rawValue)
    onEstimatorConfigurationChange({
      ...estimatorConfiguration,
      [key]: value !== undefined && Number.isFinite(value) ? value : undefined,
    })
  }

  function applyStrategy(strategy: ComparableStrategy) {
    const candidate = comparison.find((item) => item.strategy === strategy)?.config
    if (!candidate) return
    if (config.planConfirmed && !window.confirm('Applicare questa strategia sostituirà le fasi e le relative durate attuali. Vuoi continuare?')) return
    onConfigChange(candidate)
  }

  function applyConversion(type: YeastType, grams: number) {
    const percentage = yeastPercentageForMassBalance(grams, doughWeight, otherIngredientPercentages)
    if (flourWeight <= 0 || percentage === null) return
    onYeastTypeChange(type)
    onYeastPctChange(percentage)
    onConfigChange({ ...config, yeastType: type, yeastMode: 'manual', planConfirmed: true })
  }

  return (
    <div className="fermentation-subsection assisted-fermentation">
      <div className="subsection-title"><Thermometer size={15} /><h3>Profilo e confronto</h3></div>
      <div className="assisted-panel">
        <strong>{config.yeastMode === 'assisted' ? 'Modalità assistita · stima numerica non disponibile' : 'Modalità manuale · profilo termico di supporto'}</strong>
        <p>Modello lievito {YEAST_ESTIMATOR_MODEL.id} v{YEAST_ESTIMATOR_MODEL.version} · stato: non calibrato. Nessun dosaggio o tempo biologico viene dedotto dal modello.</p>
        <p>{exposure.temperatureProfile.explanation}</p>
        {firstDough && lastDough
          ? <p className="temperature-profile-summary"><Thermometer size={12} /> Impasto {firstDough.doughTemperatureSource === 'measured' ? 'misurato all’avvio' : 'stimato all’avvio'} {firstDough.doughTemperatureC} °C; al termine del piano la stima è {lastDough.doughTemperatureC} °C. Frigorifero impostato {config.refrigeratorTemperatureC} °C. I valori stimati non sono misure.</p>
          : <p className="temperature-profile-summary"><AlertTriangle size={12} /> Temperatura dell’impasto nel tempo non stimata: inserisci una misura iniziale oppure un valore iniziale ipotizzato e una costante termica nelle impostazioni avanzate.</p>}
        <p>{exposure.message} Input del ricettario: {yeastLabels[exposure.yeastInput?.type ?? yeastType]} · {exposure.yeastInput?.percentageOnFlour.toLocaleString('it-IT', { maximumFractionDigits: 3 }) ?? yeastPct.toLocaleString('it-IT', { maximumFractionDigits: 3 })}% sulla farina; non alimentano una previsione.</p>
        <div className="assisted-strategy-line"><Snowflake size={13} /><span>Strategia attiva: {STRATEGY_LABELS[config.strategy]} · ambiente {formatDuration(activeRoomTemperatureMinutes)} · frigorifero {formatDuration(activeRefrigeratorMinutes)} a {config.refrigeratorTemperatureC} °C · cottura prevista {formatItalianDateTime(config.bakingAt)}</span></div>

        <div className="assisted-subheading"><strong>Conversione aritmetica configurabile</strong><span>Dose corrente: {yeastGrams.toLocaleString('it-IT', { maximumFractionDigits: 3 })} g di lievito {yeastLabels[yeastType]} ({yeastPct.toLocaleString('it-IT', { maximumFractionDigits: 3 })}% farina).</span></div>
        {(['instant-dry', 'active-dry', 'fresh'] as YeastType[]).filter((type) => type !== yeastType).map((type) => {
          const converted = convertYeastDose(yeastGrams, yeastType, type, conversionFactors)
          return <div className="yeast-conversion-row" key={type}><span>{converted.available ? `${converted.amount!.toLocaleString('it-IT', { maximumFractionDigits: 3 })} g ${yeastLabels[type]}` : `${yeastLabels[type]}: rapporto non impostato`}</span>{converted.available && <button className="text-link" type="button" onClick={() => applyConversion(type, converted.amount!)}>Usa conversione</button>}</div>
        })}

        <button className="text-link comparison-toggle" type="button" aria-expanded={showComparison} onClick={() => setShowComparison(!showComparison)}>{showComparison ? 'Nascondi confronto strategie' : 'Confronta le strategie'}</button>
        {showComparison && <div className="strategy-comparison">{comparison.map((item) => <article className={`strategy-option${config.strategy === item.strategy ? ' selected' : ''}`} key={item.strategy}>
          <strong>{STRATEGY_LABELS[item.strategy]}</strong>
          <span>Preparazione {formatDuration(item.totalPreparationMinutes)}</span>
          <span>Ambiente {formatDuration(item.roomTemperatureMinutes)} · frigo {formatDuration(item.refrigeratorMinutes)}</span>
          <small>{item.config ? `Inizio ${formatItalianDateTime(item.config.plannedStartAt)} · cottura ${formatItalianDateTime(item.config.bakingAt)}` : item.timingRequirement}</small>
          <small>{strategyTemperatureSummary(item)}</small>
          <small>{item.practicalOperations.join(' ') || item.timingRequirement}</small>
          <small>Esposizione biologica: non calcolata.</small>
          {item.warnings.map((warning) => <small className="strategy-warning" key={warning}>{warning}</small>)}
          <button type="button" className="button button-outline" disabled={!item.config || config.strategy === item.strategy} onClick={() => applyStrategy(item.strategy)}>{config.strategy === item.strategy ? 'Strategia attiva' : 'Applica al piano'}</button>
        </article>)}</div>}

        <details className="assisted-disclosure">
          <summary>Impostazioni avanzate e limiti del modello</summary>
          <div className="assisted-config-grid">
            <label className="field"><span>Costante termica ipotizzata</span><div className="input-with-unit"><input type="number" min="1" step="1" value={estimatorConfiguration.thermalTimeConstantMinutes ?? ''} onChange={(event) => updateSetting('thermalTimeConstantMinutes', event.target.value)} placeholder="non impostata" /><small>min</small></div></label>
            <label className="field"><span>Temperatura iniziale ipotizzata <small>solo senza misura</small></span><div className="input-with-unit"><input type="number" min="-10" max="50" step="0.5" value={estimatorConfiguration.estimatedInitialDoughTemperatureC ?? ''} onChange={(event) => updateSetting('estimatedInitialDoughTemperatureC', event.target.value)} placeholder="non impostata" /><small>°C</small></div></label>
            <label className="field"><span>Rapporto fresco / secco istantaneo</span><div className="input-with-unit"><input type="number" min="0.001" step="0.1" value={estimatorConfiguration.freshPerInstantDry ?? ''} onChange={(event) => updateSetting('freshPerInstantDry', event.target.value)} placeholder="da documentare" /><small>g/g</small></div></label>
            <label className="field"><span>Rapporto fresco / secco attivo</span><div className="input-with-unit"><input type="number" min="0.001" step="0.1" value={estimatorConfiguration.freshPerActiveDry ?? ''} onChange={(event) => updateSetting('freshPerActiveDry', event.target.value)} placeholder="da documentare" /><small>g/g</small></div></label>
          </div>
          <p>La costante e la temperatura iniziale sono ipotesi dell’utente in un modello termico semplificato; non sono parametri calibrati di Lievia. Se mancano, la curva resta non stimata. Il frigorifero rallenta l’attività ma non la arresta; la dinamica termica non è una previsione biologica.</p>
          <p>Le quantità degli ingredienti derivano da calcoli aritmetici sulle percentuali. Idratazione {hydrationPct}% e sale {saltPct}% sono registrati come dati della ricetta, ma non alimentano una cinetica calibrata. W e P/L descrivono dati inseriti sulla farina e non predicono da soli la lievitazione. Fermentazione e maturazione non sono sinonimi: il piano organizza tempi e fasi, senza misurare trasformazioni biochimiche.</p>
          <p>La conversione tra lieviti applica esclusivamente i rapporti che hai impostato: documentali e verifica la scheda del prodotto. Le osservazioni personali non modificano coefficienti o stime.</p>
        </details>
      </div>
    </div>
  )
}