import { ArrowLeft, Check, CircleHelp, FlaskConical, PackageCheck, Plus, Save, Scale, Trash2, Wheat } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppData } from '../context/useAppData'
import { createDefaultDraft, STYLE_DEFAULTS, STYLE_OPTIONS } from '../data/defaults'
import { calculateDough, type DoughResult } from '../lib/calculator'
import { FermentationPlanner } from '../components/FermentationPlanner'
import { FermentationTimeline } from '../components/FermentationTimeline'
import { createDefaultFermentationConfig, formatDuration, formatItalianDateTime, STRATEGY_LABELS } from '../domain/fermentation/schedule'
import { getFlourGuidance, getTemperatureGuidance } from '../domain/fermentation/guidance'
import { YEAST_ESTIMATOR_MODEL } from '../domain/fermentation/modelConfiguration'
import { deriveBlendPropertyRanges, isFlourBlendEligible, missingBlendTechnicalData, type NumericRange } from '../domain/flours/blendProperties'
import { getStockWarnings } from '../domain/flours/pantry'
import { createRecipeConfiguration, normalizeRecipeConfiguration } from '../domain/lab/scenarios'
import type { FermentationConfig } from '../domain/fermentation/types'
import type { RecipeDraft } from '../models'

const grams = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const yeastGrams = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

function formatError(message: string) {
  if (message.includes('100%')) return 'La miscela di farine deve raggiungere esattamente il 100%.'
  if (message.includes('At least one flour')) return 'Aggiungi almeno una farina alla miscela.'
  if (message.includes('ID')) return 'Seleziona una farina valida per ogni riga.'
  if (message.includes('greater than zero')) return 'Il peso dell’impasto deve essere maggiore di zero.'
  return 'Controlla i valori inseriti: usa numeri validi e non negativi.'
}

function weightForArea(draft: RecipeDraft, shape: 'rect' | 'round') {
  const areaCm2 = shape === 'round'
    ? Math.PI * ((draft.panDiameter ?? 0) / 2) ** 2
    : (draft.panWidth ?? 0) * (draft.panLength ?? 0)
  return areaCm2 / 10_000 * draft.doughWeightPerArea
}

function formatRange(range: NumericRange | undefined, digits: number) {
  if (!range) return 'n.d.'
  const format = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: digits }).format(value)
  return range.min === range.max ? `≈ ${format(range.min)}` : `≈ ${format(range.min)}–${format(range.max)}`
}

function flourKindSuffix(flour: { productKind?: string; isDemo: boolean }) {
  if (flour.isDemo) return ' · demo'
  if (flour.productKind === 'commercial-blend') return ' · miscela commerciale'
  if (flour.productKind === 'prepared-mix') return ' · preparato non calcolabile come farina'
  return ''
}

function IngredientRow({ label, amount, percentage, yeast = false }: { label: string; amount: number; percentage: number; yeast?: boolean }) {
  return <div className={`ingredient-row${yeast ? ' yeast-ingredient-row' : ''}`}><span className="ingredient-name">{label}</span><strong className="ingredient-amount">{(yeast ? yeastGrams : grams).format(amount)} <small>g</small></strong><em className="ingredient-percentage">{new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(percentage)}%</em></div>
}

export function DoughBuilder() {
  const { flourCatalog, pantryEntries, deductPantryFlours, recipes, saveRecipe, estimatorConfiguration, updateEstimatorConfiguration } = useAppData()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const locationState = location.state as { labConfiguration?: unknown } | null
  const labConfiguration = normalizeRecipeConfiguration(locationState?.labConfiguration)
  const sourceId = searchParams.get('edit') ?? searchParams.get('duplicate')
  const source = recipes.find((recipe) => recipe.id === sourceId)
  const duplicateMode = searchParams.has('duplicate')
  const [draft, setDraft] = useState<RecipeDraft>(() => labConfiguration ? { ...labConfiguration } : source
    ? { ...source, name: duplicateMode ? `${source.name} — copia` : source.name }
    : createDefaultDraft(flourCatalog[0]?.id))
  const [editingId] = useState<string | undefined>(duplicateMode ? undefined : searchParams.get('edit') ?? undefined)
  const [panShape, setPanShape] = useState<'rect' | 'round'>(labConfiguration?.panShape ?? source?.panShape ?? 'rect')
  const [useAreaWeight, setUseAreaWeight] = useState(labConfiguration?.useAreaWeight ?? source?.useAreaWeight ?? false)
  const [fermentation, setFermentation] = useState<FermentationConfig>(() => labConfiguration?.fermentation ?? source?.fermentation ?? createDefaultFermentationConfig())
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)
  const [pantryOnly, setPantryOnly] = useState(false)
  const [stockDeducted, setStockDeducted] = useState(false)
  const showPan = ['teglia', 'padellino', 'focaccia'].includes(draft.style)
  const computedAreaWeight = weightForArea(draft, panShape)

  const inputWeight = useAreaWeight
    ? computedAreaWeight
    : draft.useTotalWeight ? draft.totalDoughWeight : undefined
  let result: DoughResult | null = null
  let calculationError = ''
  try {
    result = calculateDough({
      ballCount: draft.ballCount,
      ballWeight: draft.ballWeight,
      totalDoughWeight: inputWeight,
      useTotalWeight: draft.useTotalWeight || useAreaWeight,
      hydrationPct: draft.hydrationPct,
      saltPct: draft.saltPct,
      oilPct: draft.oilPct,
      yeastType: draft.yeastType,
      yeastPct: draft.yeastPct,
      maltPct: draft.maltPct,
      sugarPct: draft.sugarPct,
      flourBlend: draft.flourBlend,
    })
  } catch (error) {
    calculationError = formatError(error instanceof Error ? error.message : '')
  }

  function update<K extends keyof RecipeDraft>(key: K, value: RecipeDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setSaved(false)
    setFormError('')
  }

  function updateNumber(key: keyof RecipeDraft, value: string) {
    update(key, value === '' ? 0 : Number(value) as never)
  }

  function changeStyle(style: RecipeDraft['style']) {
    setDraft((current) => ({ ...current, style, ...STYLE_DEFAULTS[style] }))
    setSaved(false)
  }

  function selectWeightMode(useTotal: boolean) {
    if (useTotal) {
      const currentWeight = result?.targetDoughWeight ?? draft.ballCount * draft.ballWeight
      setUseAreaWeight(false)
      setDraft((current) => ({ ...current, useTotalWeight: true, useAreaWeight: false, totalDoughWeight: currentWeight }))
    } else {
      setDraft((current) => ({ ...current, useTotalWeight: false, useAreaWeight: false }))
      setUseAreaWeight(false)
    }
    setSaved(false)
  }

  function addFlour() {
    const nextFlour = flourCatalog.find((flour) => isFlourBlendEligible(flour) && !draft.flourBlend.some((item) => item.flourId === flour.id))
    if (!nextFlour) return
    const existingTotal = draft.flourBlend.reduce((sum, item) => sum + item.percentage, 0)
    const blend = existingTotal > 0
      ? draft.flourBlend.map((item) => ({ ...item, percentage: item.percentage / existingTotal * 80 }))
      : draft.flourBlend.map((item) => ({ ...item, percentage: 0 }))
    update('flourBlend', [...blend, { flourId: nextFlour.id, percentage: 20 }])
  }

  function removeFlour(index: number) {
    const remaining = draft.flourBlend.filter((_, itemIndex) => itemIndex !== index)
    if (remaining.length === 1) remaining[0].percentage = 100
    else if (remaining.length) {
      const sum = remaining.reduce((total, item) => total + item.percentage, 0)
      remaining.forEach((item) => { item.percentage = sum ? item.percentage / sum * 100 : 100 / remaining.length })
    }
    update('flourBlend', remaining)
  }

  function save() {
    if (!draft.name.trim()) {
      setFormError('Dai un nome al tuo impasto prima di salvarlo.')
      return
    }
    if (!result) {
      setFormError(calculationError)
      return
    }
    const savedFermentation: FermentationConfig = {
      ...fermentation,
      estimatorModelId: YEAST_ESTIMATOR_MODEL.id,
      estimatorModelVersion: YEAST_ESTIMATOR_MODEL.version,
      userYeastDoseOverride: { yeastType: draft.yeastType, yeastPct: draft.yeastPct, updatedAt: new Date().toISOString() },
    }
    saveRecipe({ ...draft, totalDoughWeight: draft.useTotalWeight || useAreaWeight ? inputWeight : undefined, useTotalWeight: draft.useTotalWeight || useAreaWeight, useAreaWeight, panShape, yeastType: fermentation.yeastType, fermentation: savedFermentation }, editingId)
    setSaved(true)
    setFormError('')
    navigate('/ricette')
  }

  const blendTotal = draft.flourBlend.reduce((sum, item) => sum + item.percentage, 0)
  const blendEligibleFlours = flourCatalog.filter(isFlourBlendEligible)
  const pantryIds = new Set(pantryEntries.map(({ flourId }) => flourId))
  const selectableFlours = flourCatalog.filter((flour) => isFlourBlendEligible(flour) && (!pantryOnly || pantryIds.has(flour.id)))
  const blendRanges = deriveBlendPropertyRanges(draft.flourBlend, flourCatalog)
  const missingBlendData = missingBlendTechnicalData(draft.flourBlend, flourCatalog)
  const stockWarnings = result ? getStockWarnings(pantryEntries, result.flourQuantities.map(({ flourId, weight }) => ({ flourId, quantityGrams: weight }))) : []
  const areaHint = Number.isFinite(computedAreaWeight) && computedAreaWeight > 0 ? grams.format(computedAreaWeight) : '—'
  const guidanceFlours = flourCatalog.map((flour) => ({
    id: flour.id,
    name: flour.name,
    strengthW: flour.officialSource ? undefined : flour.strengthW,
    strengthWRange: flour.officialSource ? { min: flour.officialSource.wMin, max: flour.officialSource.wMax } : undefined,
    proteinPct: flour.officialSource ? flour.officialSource.proteinPercent ?? undefined : flour.proteinPct,
    isDemo: flour.isDemo,
  }))
  const guidanceInput = { blend: draft.flourBlend, flours: guidanceFlours, durationMinutes: fermentation.totalDurationMinutes, hydrationPct: draft.hydrationPct, style: draft.style }

  function printRecipe() {
    window.print()
  }

  const fermentationWarnings = [
    ...getTemperatureGuidance(fermentation),
    ...getFlourGuidance(guidanceInput),
  ].map((warning) => warning.message)
  if (!fermentation.planConfirmed || fermentation.phases.reduce((sum, phase) => sum + phase.durationMinutes, 0) !== fermentation.totalDurationMinutes) {
    fermentationWarnings.unshift('Il piano di fermentazione è ancora da verificare.')
  }

  return (
    <div className="page-stack builder-page">
      <div className="builder-back"><Link to="/ricette"><ArrowLeft size={15} /> Tutte le ricette</Link><span className="eyebrow">IL TUO PROSSIMO IMPASTO</span></div>
      <section className="builder-heading"><div><p className="eyebrow">DALLE PERCENTUALI ALLE DOSI</p><h1>{editingId ? 'Modifica impasto' : duplicateMode ? 'Crea una copia' : 'Crea impasto'}</h1><p className="intro-copy">Ogni quantità si aggiorna mentre lavori alla ricetta.</p><button className="button button-outline lab-open-button" type="button" disabled={!result} onClick={() => { const name = draft.name.trim() || 'Impasto non salvato'; const sessionId = `bozza-${crypto.randomUUID()}`; const configuration = createRecipeConfiguration({ ...draft, name, yeastType: fermentation.yeastType, fermentation }, fermentation); navigate(`/lab?session=${encodeURIComponent(sessionId)}`, { state: { labBaseline: { sessionId, name, configuration } } }) }}><FlaskConical size={16} /> Apri in Lievia Lab</button></div><div className="save-field"><label className="field"><span>Nome della ricetta</span><input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Es. La mia pizza del sabato" /></label><button type="button" className="button button-primary" onClick={save}><Save size={16} /> Salva ricetta</button></div></section>
      <div className="builder-layout">
        <div className="builder-form">
          <section className="form-section"><div className="form-section-heading"><span className="step-index">01</span><div><h2>La forma dell’impasto</h2><p>Scegli una base, poi personalizzala liberamente.</p></div></div>
            <div className="field-row"><label className="field field-grow"><span>Stile</span><select value={draft.style} onChange={(event) => changeStyle(event.target.value as RecipeDraft['style'])}>{STYLE_OPTIONS.map((style) => <option value={style.id} key={style.id}>{style.id === 'focaccia' || style.id === 'personalizzato' ? style.label : `Pizza ${style.label.toLowerCase()}`}</option>)}</select></label><div className="field field-grow"><span className="field-label">Peso calcolato</span><div className="segmented-control"><button type="button" className={!draft.useTotalWeight && !useAreaWeight ? 'selected' : ''} onClick={() => selectWeightMode(false)}>Palline</button><button type="button" className={draft.useTotalWeight || useAreaWeight ? 'selected' : ''} onClick={() => selectWeightMode(true)}>Peso totale</button></div></div></div>
            {!draft.useTotalWeight && !useAreaWeight ? <div className="field-row"><label className="field"><span>Numero di palline</span><div className="input-with-unit"><input type="number" min="1" step="1" value={draft.ballCount} onChange={(event) => updateNumber('ballCount', event.target.value)} /><small>palline</small></div></label><label className="field"><span>Peso per pallina</span><div className="input-with-unit"><input type="number" min="1" step="5" value={draft.ballWeight} onChange={(event) => updateNumber('ballWeight', event.target.value)} /><small>g</small></div></label></div> : <label className="field total-weight-field"><span>{useAreaWeight ? 'Peso stimato dal formato' : 'Peso totale desiderato'}</span><div className="input-with-unit"><input type="number" min="1" step="10" value={inputWeight ?? ''} disabled={useAreaWeight} onChange={(event) => update('totalDoughWeight', Number(event.target.value))} /><small>g</small></div></label>}
            {showPan && <div className="pan-panel"><div className="pan-panel-title"><div><span className="field-label">Dimensioni del formato</span><small>Opzionale</small></div><div className="segmented-control shape-toggle"><button type="button" className={panShape === 'rect' ? 'selected' : ''} onClick={() => { setPanShape('rect'); update('panShape', 'rect') }}>Rettangolare</button><button type="button" className={panShape === 'round' ? 'selected' : ''} onClick={() => { setPanShape('round'); update('panShape', 'round') }}>Rotondo</button></div></div>
              {panShape === 'rect' ? <div className="field-row pan-dimensions"><label className="field"><span>Larghezza</span><div className="input-with-unit"><input type="number" min="0" step="1" value={draft.panWidth ?? ''} placeholder="30" onChange={(event) => update('panWidth', Number(event.target.value))} /><small>cm</small></div></label><label className="field"><span>Lunghezza</span><div className="input-with-unit"><input type="number" min="0" step="1" value={draft.panLength ?? ''} placeholder="40" onChange={(event) => update('panLength', Number(event.target.value))} /><small>cm</small></div></label></div> : <label className="field pan-diameter"><span>Diametro</span><div className="input-with-unit"><input type="number" min="0" step="1" value={draft.panDiameter ?? ''} placeholder="30" onChange={(event) => update('panDiameter', Number(event.target.value))} /><small>cm</small></div></label>}
              <label className="field density-field"><span>Dose iniziale per area <small>modificabile</small></span><div className="input-with-unit"><input type="number" min="0" step="10" value={draft.doughWeightPerArea} onChange={(event) => updateNumber('doughWeightPerArea', event.target.value)} /><small>g/m²</small></div></label>
              <div className="area-estimate"><span>Peso stimato</span><strong>{areaHint} g</strong></div>
              <label className="check-line"><input type="checkbox" checked={useAreaWeight} onChange={(event) => { const checked = event.target.checked; setUseAreaWeight(checked); setDraft((current) => ({ ...current, useTotalWeight: checked || current.useTotalWeight, useAreaWeight: checked, totalDoughWeight: checked ? computedAreaWeight : current.totalDoughWeight })) ; setSaved(false) }} /><span>Usa questo peso come totale impasto</span></label>
            </div>}
          </section>

          <section className="form-section"><div className="form-section-heading"><span className="step-index">02</span><div><h2>La miscela di farine</h2><p>Distribuisci le percentuali della farina totale.</p></div></div>
            <label className="check-line pantry-builder-filter"><input type="checkbox" checked={pantryOnly} onChange={(event) => setPantryOnly(event.target.checked)} /><span>Mostra solo farine della mia dispensa</span></label>
            <div className="blend-list">{draft.flourBlend.map((item, index) => <div className="blend-row" key={`${index}-${item.flourId}`}><label className="field blend-flour-select"><span>{index === 0 ? 'Farina' : `Farina ${index + 1}`}</span><select value={item.flourId} onChange={(event) => { const next = [...draft.flourBlend]; next[index] = { ...item, flourId: event.target.value }; update('flourBlend', next) }}><option value="">Seleziona una farina</option>{!selectableFlours.some(({ id }) => id === item.flourId) && flourCatalog.find(({ id }) => id === item.flourId) && <option value={item.flourId}>{flourCatalog.find(({ id }) => id === item.flourId)!.brand} · {flourCatalog.find(({ id }) => id === item.flourId)!.name} · non in dispensa</option>}{selectableFlours.map((flour) => <option value={flour.id} key={flour.id}>{flour.brand} · {flour.name}{flourKindSuffix(flour)}{flour.isDemo ? '' : pantryIds.has(flour.id) ? ' · in dispensa' : ' · fuori dispensa'}</option>)}</select></label><label className="field blend-percentage"><span>Percentuale</span><div className="input-with-unit"><input type="number" min="0" max="100" step="0.1" value={item.percentage} onChange={(event) => { const next = [...draft.flourBlend]; next[index] = { ...item, percentage: Number(event.target.value) }; update('flourBlend', next) }} /><small>%</small></div></label>{draft.flourBlend.length > 1 && <button type="button" className="icon-button blend-remove" title="Rimuovi farina" aria-label="Rimuovi farina" onClick={() => removeFlour(index)}><Trash2 size={16} /></button>}</div>)}</div>
            {pantryOnly && <p className="catalogue-result-count">{selectableFlours.filter(({ id }) => pantryIds.has(id)).length} farine in dispensa · <button className="text-link" type="button" onClick={() => setPantryOnly(false)}>Sfoglia il catalogo completo</button></p>}
            {flourCatalog.some((flour) => flour.productKind === 'prepared-mix') && <p className="prepared-mix-warning">I preparati con ingredienti aggiunti restano consultabili nel catalogo ma non sono selezionabili come farina: le loro proporzioni interne non sono disponibili per il calcolo.</p>}
            <div className={`blend-total${Math.abs(blendTotal - 100) < 1e-6 ? ' valid' : ' invalid'}`}><span>Totale miscela</span><strong>{new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(blendTotal)}%</strong><small>{Math.abs(blendTotal - 100) < 1e-6 ? 'Composizione completa' : 'Il totale deve essere 100%'}</small></div>
            {draft.flourBlend.length < blendEligibleFlours.length && <button type="button" className="text-link add-flour-button" onClick={addFlour}><Plus size={15} /> Aggiungi un’altra farina</button>}
            <div className="blend-estimates"><div className="estimate-heading"><span>SCENARIO ARITMETICO DELLA MISCELA</span><span title="Intervalli pesati dei dati dichiarati" aria-label="Intervalli pesati dei dati dichiarati"><CircleHelp size={15} /></span></div><div className="estimate-values"><div><small>W · scenario non validato</small><strong>{formatRange(blendRanges.w, 0)}</strong></div><div><small>P/L · scenario non validato</small><strong>{formatRange(blendRanges.pl, 2)}</strong></div><div><small>Proteine · media ponderata</small><strong>{blendRanges.protein ? `${formatRange(blendRanges.protein, 1)}%` : 'n.d.'}</strong></div></div>{missingBlendData.length > 0 && <p className="blend-missing-data"><strong>Dati tecnici mancanti:</strong> {missingBlendData.map(({ flourName, fields }) => `${flourName} (${fields.join(', ')})`).join('; ')}.</p>}<p>Le percentuali e i pesi della miscela sono elencati nel calcolo. W e P/L sono indicatori aritmetici grezzi, non proprietà validate della miscela. La media proteica è stimabile solo con valori noti per tutte le farine.</p></div>
            {stockWarnings.length > 0 && <div className="pantry-stock-warning" role="status"><strong>Disponibilità da verificare</strong>{stockWarnings.map((warning) => { const flour = flourCatalog.find(({ id }) => id === warning.flourId); const status = warning.reason === 'not-in-pantry' ? 'non registrata in dispensa' : warning.reason === 'quantity-unknown' ? 'quantità disponibile non nota' : `servono ${grams.format(warning.requiredGrams)} g, disponibili ${grams.format(warning.availableGrams ?? 0)} g`; return <p key={warning.flourId}>{flour?.brand} · {flour?.name}: {status}.</p> })}Il calcolo resta invariato; aggiorna la dispensa o scegli consapevolmente un’altra farina.</div>}
          </section>

          <section className="form-section"><div className="form-section-heading"><span className="step-index">03</span><div><h2>Idratazione e condimento</h2><p>I valori iniziali cambiano con lo stile e restano sempre modificabili.</p></div></div>
            <div className="percentage-grid"><label className="field"><span>Idratazione</span><div className="input-with-unit"><input type="number" min="0" step="0.5" value={draft.hydrationPct} onChange={(event) => updateNumber('hydrationPct', event.target.value)} /><small>%</small></div></label><label className="field"><span>Sale</span><div className="input-with-unit"><input type="number" min="0" step="0.1" value={draft.saltPct} onChange={(event) => updateNumber('saltPct', event.target.value)} /><small>%</small></div></label><label className="field"><span>Olio</span><div className="input-with-unit"><input type="number" min="0" step="0.1" value={draft.oilPct} onChange={(event) => updateNumber('oilPct', event.target.value)} /><small>%</small></div></label></div>
          </section>

          <section className="form-section"><div className="form-section-heading"><span className="step-index">03b</span><div><h2>Altri ingredienti</h2><p>Malto e zucchero sono facoltativi e incidono sul peso totale.</p></div></div>
            <div className="percentage-grid"><label className="field"><span>Malto <small>opzionale</small></span><div className="input-with-unit"><input type="number" min="0" step="0.1" value={draft.maltPct} onChange={(event) => updateNumber('maltPct', event.target.value)} /><small>%</small></div></label><label className="field"><span>Zucchero <small>opzionale</small></span><div className="input-with-unit"><input type="number" min="0" step="0.1" value={draft.sugarPct} onChange={(event) => updateNumber('sugarPct', event.target.value)} /><small>%</small></div></label></div>
          </section>

          <FermentationPlanner
            config={fermentation}
            onChange={setFermentation}
            yeastPct={draft.yeastPct}
            yeastType={draft.yeastType}
            flourWeight={result?.flourWeight ?? 0}
            guidanceInput={guidanceInput}
            onYeastPctChange={(yeastPct) => update('yeastPct', yeastPct)}
            onYeastTypeChange={(yeastType) => update('yeastType', yeastType)}
            estimatorConfiguration={estimatorConfiguration}
            onEstimatorConfigurationChange={updateEstimatorConfiguration}
            hydrationPct={draft.hydrationPct}
            saltPct={draft.saltPct}
            doughWeight={result?.targetDoughWeight ?? 0}
            otherIngredientPercentages={draft.hydrationPct + draft.saltPct + draft.oilPct + draft.maltPct + draft.sugarPct}
            onPrint={printRecipe}
          />
        </div>

        <aside className="result-panel"><div className="result-panel-heading"><div><p className="eyebrow">IL TUO IMPASTO</p><h2>Le dosi</h2></div><span className="result-live"><i /> LIVE</span></div>
          {result ? <><div className="result-total"><span>Peso totale</span><strong>{grams.format(result.totalDoughWeight)}<small>g</small></strong><p>{draft.useTotalWeight || useAreaWeight ? 'peso totale desiderato' : `${draft.ballCount} palline da ${draft.ballWeight} g`}</p></div>
            <div className="ingredient-group"><div className="ingredient-group-title"><Wheat size={15} /><span>FARINE</span></div>{result.flourQuantities.map((item, index) => { const flour = flourCatalog.find((candidate) => candidate.id === item.flourId); return <IngredientRow key={`${item.flourId}-${index}`} label={flour ? `${flour.brand} · ${flour.name}` : 'Farina non disponibile'} amount={item.weight} percentage={item.percentage} /> })}<div className="ingredient-row ingredient-subtotal"><span>Farina totale</span><strong>{grams.format(result.flourWeight)} <small>g</small></strong><em>100%</em></div></div>
            <div className="ingredient-group"><div className="ingredient-group-title"><Scale size={15} /><span>INGREDIENTI</span></div><IngredientRow label="Acqua" amount={result.waterWeight} percentage={result.bakerPercentages.water} /><IngredientRow label="Sale" amount={result.saltWeight} percentage={result.bakerPercentages.salt} /><IngredientRow label="Olio" amount={result.oilWeight} percentage={result.bakerPercentages.oil} /><IngredientRow label={draft.yeastType === 'fresh' ? 'Lievito fresco' : draft.yeastType === 'instant-dry' ? 'Lievito secco istantaneo' : 'Lievito secco attivo'} amount={result.yeastWeight} percentage={result.bakerPercentages.yeast} yeast /><IngredientRow label="Malto" amount={result.maltWeight} percentage={result.bakerPercentages.malt} /><IngredientRow label="Zucchero" amount={result.sugarWeight} percentage={result.bakerPercentages.sugar} /></div>
            <div className="mass-note"><Check size={14} /><span>Bilancio completo · pesi calcolati con precisione interna</span></div>
            {!stockDeducted && <button className="button button-outline pantry-deduct-button" type="button" onClick={() => { if (!window.confirm('Confermi lo scarico dalla dispensa delle quantità di farina previste da questa ricetta?')) return; const unavailable = deductPantryFlours(draft.flourBlend, result.flourWeight); if (unavailable.length) { window.alert('Quantità non note o scorte insufficienti per tutte le farine selezionate. La dispensa non è stata modificata.'); return } setStockDeducted(true) }}><PackageCheck size={16} /> Scala farine dalla dispensa</button>}
              <section className="result-fermentation"><div className="result-fermentation-heading"><div><p className="eyebrow">IL PIANO</p><h3>Lievitazione</h3></div><button type="button" className="text-link" onClick={() => document.querySelector('#fermentation-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Modifica piano</button></div>
                <div className="result-fermentation-meta"><span>{STRATEGY_LABELS[fermentation.strategy]}</span><strong className="result-fermentation-duration">{formatDuration(fermentation.totalDurationMinutes)}</strong><small>Ambiente {fermentation.ambientTemperatureC} °C · Frigo {fermentation.refrigeratorTemperatureC} °C</small><small>Preparazione · {formatItalianDateTime(fermentation.plannedStartAt)}</small><small className="summary-bake-target">Cottura prevista · {formatItalianDateTime(fermentation.bakingAt)}</small><small className="summary-yeast-dose">Dose lievito · {yeastGrams.format(result.yeastWeight)} g · {fermentation.yeastMode === 'manual' ? 'manuale' : 'assistita, modello non calibrato'}</small>{fermentation.yeastMode === 'assisted' && <small>Modello · {fermentation.estimatorModelId ?? YEAST_ESTIMATOR_MODEL.id} v{fermentation.estimatorModelVersion ?? YEAST_ESTIMATOR_MODEL.version} · nessuna dose numerica disponibile</small>}{fermentation.userYeastDoseOverride && <small>Override utente · {fermentation.userYeastDoseOverride.yeastPct}% farina · {fermentation.userYeastDoseOverride.yeastType}</small>}</div>
                <FermentationTimeline config={fermentation} compact />
                {fermentationWarnings.map((warning) => <p className="summary-warning" key={warning}><CircleHelp size={13} />{warning}</p>)}
              </section>
          </> : <div className="calculation-warning"><CircleHelp size={18} /><p>{calculationError}</p></div>}
          {formError && <p className="form-error result-error" role="alert">{formError}</p>}
          {saved && <p className="form-success"><Check size={15} /> Ricetta salvata</p>}
          <button type="button" className="button button-primary result-save" onClick={save}><Save size={16} /> Salva ricetta</button>
          <p className="rounding-note">Le dosi mostrate sono arrotondate per l’uso in cucina. Il calcolo interno mantiene la precisione completa.</p>
        </aside>
      </div>
      <section className="print-recipe" aria-label="Ricetta completa per la stampa">
        <p className="eyebrow">LIEVIA · THE SCIENCE OF DOUGH</p><h1>{draft.name || 'Ricetta senza nome'}</h1>
        <p>{draft.style} · {formatDuration(fermentation.totalDurationMinutes)} · {STRATEGY_LABELS[fermentation.strategy]}</p>
        {result && <div className="print-ingredients"><h2>Ingredienti · {grams.format(result.totalDoughWeight)} g</h2><ul>{result.flourQuantities.map((item, index) => { const flour = flourCatalog.find(({ id }) => id === item.flourId); return <li key={`${item.flourId}-${index}`}>{flour ? `${flour.brand} · ${flour.name}` : 'Farina'}: {grams.format(item.weight)} g ({item.percentage}%)</li> })}<li>Acqua: {grams.format(result.waterWeight)} g</li><li>Sale: {grams.format(result.saltWeight)} g</li><li>Olio: {grams.format(result.oilWeight)} g</li><li>Lievito: {yeastGrams.format(result.yeastWeight)} g ({draft.yeastPct}% farina, {fermentation.yeastMode})</li>{result.maltWeight > 0 && <li>Malto: {grams.format(result.maltWeight)} g</li>}{result.sugarWeight > 0 && <li>Zucchero: {grams.format(result.sugarWeight)} g</li>}</ul></div>}
        <h2>Fasi · {formatItalianDateTime(fermentation.plannedStartAt)} – {formatItalianDateTime(fermentation.bakingAt)}</h2><FermentationTimeline config={fermentation} />
        <p>Ambiente {fermentation.ambientTemperatureC} °C · Impasto misurato {fermentation.measuredDoughTemperatureC ?? 'non indicato'} °C · Frigorifero {fermentation.refrigeratorTemperatureC} °C</p>
        {fermentationWarnings.map((warning) => <p key={warning}>{warning}</p>)}
      </section>
      <footer className="page-foot"><span>LIEVIA · CALCOLO BAKER’S PERCENTAGE</span><span>DOSAGGIO NON CALIBRATO</span></footer>
    </div>
  )
}