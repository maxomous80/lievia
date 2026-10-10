import { ArrowRight, Check, Copy, FlaskConical, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FermentationTimeline } from '../components/FermentationTimeline'
import { useAppData } from '../context/useAppData'
import { createDefaultDraft, STYLE_OPTIONS } from '../data/defaults'
import { deriveBlendPropertyRanges, isFlourBlendEligible, missingBlendTechnicalData } from '../domain/flours/blendProperties'
import { calculateScenario, compareScenarios, createRecipeConfiguration, normalizeRecipeConfiguration, recipeToConfiguration, type FermentationPatch, type RecipeConfiguration, type RecipePatch, type ResultClassification } from '../domain/lab/scenarios'
import { createAlternativeScenario, createLabSession, normalizeLabWorkspace, patchScenario, prepareScenarioApplication, removeScenario, renameScenario, resetScenario, selectScenario, upsertLabSession, type LabSession } from '../domain/lab/workspace'
import { createDefaultFermentationConfig, formatDuration, STRATEGY_LABELS, toLocalDateTimeValue, updatePhase } from '../domain/fermentation/schedule'
import type { FermentationConfig } from '../domain/fermentation/types'
import type { Flour } from '../models'

const amount = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 })
const strategies = Object.entries(STRATEGY_LABELS) as Array<[FermentationConfig['strategy'], string]>

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function currentTimestamp() {
  return new Date().toISOString()
}

function timeValue(iso: string) {
  try { return toLocalDateTimeValue(iso) } catch { return '' }
}

function formatDate(iso: string) {
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Orario non valido'
}

function formatRange(min: number | null | undefined, max: number | null | undefined, digits = 0) {
  if (min == null || max == null) return 'n.d.'
  const format = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: digits }).format(value)
  return min === max ? format(min) : `${format(min)}–${format(max)}`
}

function classificationClass(classification: ResultClassification) {
  return classification === 'calcolo esatto' ? 'lab-class-exact'
    : classification === 'stima aritmetica' ? 'lab-class-arithmetic'
      : classification === 'stima empirica' ? 'lab-class-empirical' : 'lab-class-insufficient'
}

function recipeFieldLabel(flour: Flour | undefined, flourId: string) {
  return flour ? `${flour.brand} · ${flour.name}` : `Farina non disponibile · ${flourId}`
}

function phaseLabel(type: FermentationConfig['phases'][number]['type']) {
  return ({ mixing: 'Impasto e lavorazione', 'initial-rest': 'Riposo iniziale', 'bulk-fermentation': 'Puntata', folding: 'Pieghe', dividing: 'Staglio e formatura', refrigeration: 'Fermentazione in frigorifero', 'final-proof': 'Appretto', baking: 'Cottura' } as const)[type]
}

function flourProperties(flour: Flour | undefined) {
  const record = flour?.officialSource
  const w = record ? formatRange(record.wMin, record.wMax) : flour?.strengthW === undefined ? 'n.d.' : formatRange(flour.strengthW, flour.strengthW)
  const pl = record ? formatRange(record.plMin, record.plMax, 2) : flour?.plRatio === undefined ? 'n.d.' : formatRange(flour.plRatio, flour.plRatio, 2)
  const protein = record?.proteinPercent ?? flour?.proteinPct
  return { w, pl, protein: protein == null ? 'n.d.' : `${percent.format(protein)}%` }
}

function baselineFromLocation(state: unknown): { sessionId?: string; name: string; configuration: RecipeConfiguration } | undefined {
  if (!isRecord(state) || !isRecord(state.labBaseline) || typeof state.labBaseline.name !== 'string') return undefined
  const configuration = normalizeRecipeConfiguration(state.labBaseline.configuration)
  if (!configuration) return undefined
  return { sessionId: typeof state.labBaseline.sessionId === 'string' ? state.labBaseline.sessionId : undefined, name: state.labBaseline.name, configuration }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function LieviaLab() {
  const { recipes, flourCatalog, pantryEntries, labWorkspace, saveLabWorkspace, saveRecipe } = useAppData()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [fallbackRouteId] = useState(() => `lab-${createId()}`)
  const [nameDraftState, setNameDraftState] = useState<{ scenarioId: string; value: string } | null>(null)
  const [showPantryOnly, setShowPantryOnly] = useState(false)
  const [issues, setIssues] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const workspace = normalizeLabWorkspace(labWorkspace)
  const requestedSessionId = searchParams.get('session')
  const requestedRecipeId = searchParams.get('recipe')
  const routeBaseline = baselineFromLocation(location.state)
  const targetSessionId = requestedSessionId ?? (requestedRecipeId ? `recipe:${requestedRecipeId}:${fallbackRouteId}` : workspace.activeSessionId ?? fallbackRouteId)
  const session = workspace.sessions.find(({ id }) => id === targetSessionId)
  const baselineRecipe = requestedRecipeId ? recipes.find(({ id }) => id === requestedRecipeId) : recipes[0]
  const fallbackConfiguration = useMemo(() => {
    if (baselineRecipe?.fermentation) return recipeToConfiguration(baselineRecipe, baselineRecipe.fermentation)
    const fermentation = createDefaultFermentationConfig()
    return createRecipeConfiguration({ ...createDefaultDraft(flourCatalog[0]?.id), name: baselineRecipe?.name ?? 'Impasto di prova' }, fermentation)
  }, [baselineRecipe, flourCatalog])

  useEffect(() => {
    if (session) return
    const configuration = routeBaseline?.configuration ?? fallbackConfiguration
    const name = routeBaseline?.name ?? baselineRecipe?.name ?? 'Impasto di prova'
    const recipeId = routeBaseline ? undefined : requestedRecipeId && baselineRecipe ? baselineRecipe.id : !requestedSessionId && baselineRecipe ? baselineRecipe.id : undefined
    const sessionId = requestedSessionId ?? routeBaseline?.sessionId ?? targetSessionId
    const created = createLabSession({
      id: sessionId,
      baselineId: recipeId ? `recipe:${recipeId}` : sessionId,
      baselineName: name,
      baselineConfiguration: configuration,
      sourceRecipeId: recipeId,
      scenarioId: `${sessionId}:scenario:1`,
      now: new Date().toISOString(),
    })
    saveLabWorkspace(upsertLabSession(workspace, created))
    if (!requestedSessionId) navigate(`/lab?session=${encodeURIComponent(sessionId)}`, { replace: true, state: null })
  }, [session, routeBaseline, fallbackConfiguration, baselineRecipe, requestedRecipeId, requestedSessionId, targetSessionId, workspace, saveLabWorkspace, navigate])

  const scenario = session?.scenarios.find(({ id }) => id === session.selectedScenarioId) ?? session?.scenarios[0]
  const nameDraft = scenario && nameDraftState?.scenarioId === scenario.id ? nameDraftState.value : scenario?.name ?? ''

  function commit(next: LabSession) {
    saveLabWorkspace(upsertLabSession(workspace, next))
  }

  function edit(patch: RecipePatch) {
    if (!session || !scenario) return
    const result = patchScenario(session, scenario.id, patch, flourCatalog, currentTimestamp())
    setIssues(result.issues.map(({ message: issue }) => issue))
    if (!result.issues.length) {
      commit(result.session)
      setMessage('Scenario aggiornato; la ricetta di riferimento e la dispensa non sono state modificate.')
    }
  }

  function updateFermentation(patch: FermentationPatch) {
    if (!scenario) return
    edit({ fermentation: patch })
  }

  function changeTemperature(field: 'ambientTemperatureC' | 'refrigeratorTemperatureC' | 'measuredDoughTemperatureC', value: number | undefined) {
    if (!scenario) return
    const environment = field === 'ambientTemperatureC' ? 'ambient' : field === 'refrigeratorTemperatureC' ? 'refrigerator' : undefined
    const phases = environment ? scenario.configuration.fermentation.phases.map((phase) => phase.environment === environment ? { ...phase, temperatureC: value ?? phase.temperatureC } : phase) : undefined
    updateFermentation({ [field]: value, ...(phases ? { phases } : {}) })
  }

  function changePhaseDuration(phaseId: string, durationMinutes: number) {
    if (!scenario) return
    try {
      const updated = updatePhase(scenario.configuration.fermentation, phaseId, { durationMinutes })
      updateFermentation({ phases: updated.phases, totalDurationMinutes: updated.totalDurationMinutes, plannedStartAt: updated.plannedStartAt, bakingAt: updated.bakingAt })
    } catch (error) {
      setIssues([error instanceof Error ? error.message : 'La durata della fase non è valida.'])
    }
  }

  function changePhaseLock(phaseId: string, boundaryLocked: boolean) {
    if (!scenario) return
    const phases = scenario.configuration.fermentation.phases.map((phase) => phase.id === phaseId ? { ...phase, boundaryLocked } : phase)
    updateFermentation({ phases })
  }

  function changeFlour(index: number, flourId: string) {
    if (!scenario) return
    const flourBlend = scenario.configuration.flourBlend.map((item, itemIndex) => itemIndex === index ? { ...item, flourId } : item)
    edit({ flourBlend })
  }

  function addFlour() {
    if (!scenario) return
    const existing = scenario.configuration.flourBlend
    const pool = flourCatalog.filter((flour) => isFlourBlendEligible(flour) && (!showPantryOnly || pantryEntries.some(({ flourId }) => flourId === flour.id)))
    const next = pool.find((flour) => !existing.some(({ flourId }) => flourId === flour.id))
    if (!next) {
      setIssues(['Non ci sono altre farine selezionabili con i filtri attuali.'])
      return
    }
    const total = existing.reduce((sum, item) => sum + item.percentage, 0)
    const flourBlend = total > 0
      ? [...existing.map((item) => ({ ...item, percentage: item.percentage * 0.8 })), { flourId: next.id, percentage: 20 }]
      : [...existing.map((item) => ({ ...item, percentage: 0 })), { flourId: next.id, percentage: 100 }]
    edit({ flourBlend })
  }

  function replaceFlour(index: number, flourId: string) {
    changeFlour(index, flourId)
    setMessage('Farina sostituita su tua scelta. La somiglianza dei dati non implica equivalenza tecnica.')
  }

  function createScenario(duplicate = false) {
    if (!session) return
    const next = createAlternativeScenario(session, createId(), currentTimestamp(), duplicate ? scenario?.id : undefined)
    commit(next)
    setIssues([])
  }

  function saveScenarioName() {
    if (!session || !scenario || !nameDraft.trim()) return
    commit(renameScenario(session, scenario.id, nameDraft, currentTimestamp()))
    setMessage('Nome scenario salvato.')
  }

  function removeCurrentScenario() {
    if (!session || !scenario || session.scenarios.length <= 1) return
    if (!window.confirm(`Eliminare lo scenario “${scenario.name}”? La ricetta di riferimento e quelle salvate resteranno invariate.`)) return
    commit(removeScenario(session, scenario.id, currentTimestamp()))
  }

  function resetCurrentScenario() {
    if (!session || !scenario) return
    if (!window.confirm('Ripristinare questo scenario ai valori della ricetta di riferimento?')) return
    commit(resetScenario(session, scenario.id, currentTimestamp()))
    setIssues([])
    setMessage('Scenario ripristinato ai valori della ricetta di riferimento.')
  }

  function selectCurrentScenario(id: string) {
    if (!session) return
    commit(selectScenario(session, id, currentTimestamp()))
    setIssues([])
  }

  function saveAsNewRecipe() {
    if (!scenario || !session) return
    const name = `${session.baselineName} · ${scenario.name}`.slice(0, 100)
    saveRecipe({ ...scenario.configuration, name, yeastType: scenario.configuration.fermentation.yeastType })
    setMessage('Scenario salvato come nuova ricetta. L’originale è rimasta invariata.')
    navigate('/ricette')
  }

  function applyAsDraft() {
    if (!session || !scenario) return
    if (!window.confirm('Aprire questo scenario nel calcolatore come nuovo impasto non salvato? La ricetta originale non verrà modificata.')) return
    const configuration = prepareScenarioApplication(session, scenario.id, true)
    if (!configuration) return
    navigate('/impasto', { state: { labConfiguration: { ...configuration, name: `${session.baselineName} · ${scenario.name}` } } })
  }

  if (!session || !scenario) return <div className="page-stack"><p className="lab-loading">Preparo la sessione di confronto…</p></div>

  const baseline = calculateScenario('baseline', session.baselineName, session.baselineConfiguration, flourCatalog, pantryEntries)
  const alternative = calculateScenario(scenario.id, scenario.name, scenario.configuration, flourCatalog, pantryEntries)
  const comparison = compareScenarios(baseline, alternative)
  const pantryIds = new Set(pantryEntries.map(({ flourId }) => flourId))
  const selectedOutsidePantry = scenario.configuration.flourBlend.flatMap((item, index) => pantryIds.has(item.flourId) ? [] : [{ ...item, index }])
  const availableFlours = flourCatalog.filter((flour) => isFlourBlendEligible(flour) && (!showPantryOnly || pantryIds.has(flour.id)))
  const activeRecipeValue = session.sourceRecipeId ?? '__baseline__'
  const duration = scenario.configuration.fermentation.totalDurationMinutes

  return <div className="page-stack lab-page">
    <section className="page-intro-row lab-intro"><div><p className="eyebrow">SIMULAZIONE LOCALE · NESSUNA MODIFICA AUTOMATICA</p><h1>Lievia Lab</h1><p className="intro-copy">Confronta una ricetta con scenari alternativi. Solo i comandi espliciti salvano o trasferiscono le modifiche.</p></div><span className="lab-mark"><FlaskConical size={20} /> COSA CAMBIA</span></section>

    <div className="lab-toolbar"><label className="field"><span>Ricetta di riferimento</span><select value={activeRecipeValue} onChange={(event) => { if (event.target.value !== '__baseline__') navigate(`/lab?recipe=${encodeURIComponent(event.target.value)}`) }}><option value="__baseline__">{session.baselineName}{session.sourceRecipeId ? ' · salvata' : ' · bozza'}</option>{recipes.filter(({ id }) => id !== session.sourceRecipeId).map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.name}</option>)}</select></label><div className="lab-scenario-tools"><label className="field"><span>Scenario a confronto</span><select value={scenario.id} onChange={(event) => selectCurrentScenario(event.target.value)}>{session.scenarios.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button className="button button-outline" type="button" onClick={() => createScenario(false)}><Plus size={16} /> Nuovo</button><button className="button button-outline" type="button" onClick={() => createScenario(true)}><Copy size={16} /> Duplica</button></div></div>

    <div className="lab-workbench">
      <article className="lab-recipe-panel lab-baseline"><div className="lab-panel-heading"><div><p className="eyebrow">RICETTA DI RIFERIMENTO · SOLA LETTURA</p><h2>{session.baselineName}</h2></div><span className="lab-readonly"><Check size={14} /> Originale</span></div>
        <p className="lab-recipe-meta">{STYLE_OPTIONS.find(({ id }) => id === session.baselineConfiguration.style)?.label} · {session.baselineConfiguration.hydrationPct}% idratazione · {session.baselineConfiguration.fermentation.refrigeratorTemperatureC} °C frigo</p>
        <IngredientSummary result={baseline} flours={flourCatalog} />
        <BlendSummary configuration={session.baselineConfiguration} flours={flourCatalog} />
        <ScheduleSummary result={baseline} />
      </article>

      <article className="lab-recipe-panel lab-alternative"><div className="lab-panel-heading"><div><p className="eyebrow">SCENARIO ALTERNATIVO</p><h2>Modifica e confronta</h2></div><button className="icon-button danger-icon" type="button" aria-label={`Elimina ${scenario.name}`} title="Elimina scenario" disabled={session.scenarios.length <= 1} onClick={removeCurrentScenario}><Trash2 size={17} /></button></div>
        <div className="lab-scenario-name"><label className="field"><span>Nome scenario</span><input value={nameDraft} onChange={(event) => setNameDraftState({ scenarioId: scenario.id, value: event.target.value })} onBlur={saveScenarioName} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveScenarioName() } }} /></label><button className="icon-button" type="button" aria-label="Salva nome scenario" title="Salva nome" onClick={saveScenarioName}><Check size={17} /></button><button className="icon-button" type="button" aria-label="Ripristina scenario ai valori di riferimento" title="Ripristina ai valori di riferimento" onClick={resetCurrentScenario}><RotateCcw size={17} /></button></div>
        {issues.length > 0 && <div className="lab-issues" role="alert"><strong>Controlla queste modifiche</strong>{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
        <details className="lab-editor-group" open><summary>Impasto e ingredienti</summary><div className="lab-editor-grid">
          <label className="field"><span>Stile pizza</span><select value={scenario.configuration.style} onChange={(event) => edit({ style: event.target.value as RecipeConfiguration['style'] })}>{STYLE_OPTIONS.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}</select></label>
          <label className="field"><span>Idratazione · %</span><input type="number" min="0" max="300" step="0.5" value={scenario.configuration.hydrationPct} onChange={(event) => edit({ hydrationPct: Number(event.target.value) })} /></label>
          <label className="field"><span>Sale · %</span><input type="number" min="0" max="100" step="0.1" value={scenario.configuration.saltPct} onChange={(event) => edit({ saltPct: Number(event.target.value) })} /></label>
          <label className="field"><span>Olio · %</span><input type="number" min="0" max="100" step="0.1" value={scenario.configuration.oilPct} onChange={(event) => edit({ oilPct: Number(event.target.value) })} /></label>
          <label className="field"><span>Lievito</span><select value={scenario.configuration.yeastType} onChange={(event) => edit({ yeastType: event.target.value as RecipeConfiguration['yeastType'], fermentation: { yeastType: event.target.value as RecipeConfiguration['yeastType'] } })}><option value="fresh">Fresco</option><option value="instant-dry">Secco istantaneo</option><option value="active-dry">Secco attivo</option></select></label>
          <label className="field"><span>Dosaggio manuale · % farina</span><input type="number" min="0" max="100" step="0.001" value={scenario.configuration.yeastPct} onChange={(event) => edit({ yeastPct: Number(event.target.value) })} /></label>
          <label className="check-line lab-total-toggle"><input type="checkbox" checked={scenario.configuration.useTotalWeight || scenario.configuration.useAreaWeight === true} onChange={(event) => edit(event.target.checked ? { useTotalWeight: true, useAreaWeight: false, totalDoughWeight: alternative.dough?.targetDoughWeight ?? scenario.configuration.totalDoughWeight ?? scenario.configuration.ballCount * scenario.configuration.ballWeight } : { useTotalWeight: false, useAreaWeight: false })} /><span>Imposta massa totale</span></label>
          {scenario.configuration.useTotalWeight ? <label className="field"><span>Massa totale · g</span><input type="number" min="1" max="100000" step="10" value={scenario.configuration.totalDoughWeight ?? ''} onChange={(event) => edit({ totalDoughWeight: Number(event.target.value) })} /></label> : <><label className="field"><span>Numero panetti</span><input type="number" min="1" max="100" step="1" value={scenario.configuration.ballCount} onChange={(event) => edit({ ballCount: Number(event.target.value) })} /></label><label className="field"><span>Peso panetto · g</span><input type="number" min="1" max="10000" step="5" value={scenario.configuration.ballWeight} onChange={(event) => edit({ ballWeight: Number(event.target.value) })} /></label></>}
        </div></details>

        <details className="lab-editor-group" open><summary>Miscela di farine</summary><label className="check-line lab-pantry-toggle"><input type="checkbox" checked={showPantryOnly} onChange={(event) => setShowPantryOnly(event.target.checked)} /><span>Usa solo farine disponibili</span></label>
          {scenario.configuration.flourBlend.map((item, index) => {
            const selected = flourCatalog.find(({ id }) => id === item.flourId)
            const options = availableFlours.some(({ id }) => id === item.flourId) || !showPantryOnly ? availableFlours : [selected, ...availableFlours].filter((flour): flour is Flour => Boolean(flour))
            return <div className="lab-flour-row" key={`${index}-${item.flourId}`}><label className="field"><span>Farina {index + 1}{selected && !pantryIds.has(selected.id) ? ' · fuori dispensa' : ''}</span><select value={item.flourId} onChange={(event) => changeFlour(index, event.target.value)}>{options.map((flour) => <option key={flour.id} value={flour.id}>{recipeFieldLabel(flour, flour.id)}{pantryIds.has(flour.id) ? ' · disponibile in dispensa' : ''}</option>)}</select></label><label className="field"><span>Percentuale · %</span><input type="number" min="0" max="100" step="0.1" value={item.percentage} onChange={(event) => { const flourBlend = scenario.configuration.flourBlend.map((row, rowIndex) => rowIndex === index ? { ...row, percentage: Number(event.target.value) } : row); edit({ flourBlend }) }} /></label>{scenario.configuration.flourBlend.length > 1 && <button className="icon-button danger-icon" type="button" aria-label={`Rimuovi farina ${index + 1}`} title="Rimuovi farina" onClick={() => { const remaining = scenario.configuration.flourBlend.filter((_, rowIndex) => rowIndex !== index); const remainingTotal = remaining.reduce((sum, row) => sum + row.percentage, 0); edit({ flourBlend: remaining.map((row) => ({ ...row, percentage: remainingTotal ? row.percentage / remainingTotal * 100 : 100 / remaining.length })) }) }}><Trash2 size={16} /></button>}</div>
          })}
          <div className={`lab-blend-total${Math.abs(scenario.configuration.flourBlend.reduce((sum, item) => sum + item.percentage, 0) - 100) < 1e-6 ? ' valid' : ' invalid'}`}>Totale miscela <strong>{percent.format(scenario.configuration.flourBlend.reduce((sum, item) => sum + item.percentage, 0))}%</strong></div>
          <button className="text-link lab-add-flour" type="button" onClick={addFlour}><Plus size={15} /> Aggiungi una farina</button>
          {showPantryOnly && selectedOutsidePantry.length > 0 && <div className="lab-candidates"><strong>Candidati in dispensa · non equivalenze verificate</strong><p>Scegli esplicitamente una sostituzione; W simile non dimostra un comportamento equivalente.</p>{selectedOutsidePantry.map(({ flourId, percentage: share, index }) => <div className="lab-candidate-group" key={flourId}><span>Sostituzione per {recipeFieldLabel(flourCatalog.find(({ id }) => id === flourId), flourId)} ({percent.format(share)}%)</span>{flourCatalog.filter((flour) => pantryIds.has(flour.id) && isFlourBlendEligible(flour) && flour.id !== flourId).map((flour) => { const known = flourProperties(flour); const missing = missingBlendTechnicalData([{ flourId: flour.id, percentage: 100 }], flourCatalog)[0]?.fields ?? []; const stock = pantryEntries.find(({ flourId: id }) => id === flour.id); return <div className="lab-candidate" key={flour.id}><span><strong>{recipeFieldLabel(flour, flour.id)}</strong><small>W {known.w} · P/L {known.pl} · proteine {known.protein}{missing.length ? ` · mancanti: ${missing.join(', ')}` : ''} · scorta {stock?.quantityGrams == null ? 'non nota' : `${amount.format(stock.quantityGrams)} g`}</small></span><button className="button button-outline" type="button" onClick={() => replaceFlour(index, flour.id)}>Sostituisci</button></div> })}</div>)}</div>}
          {alternative.stockWarnings.length > 0 && <div className="lab-stock-warning" role="status"><strong>Verifica disponibilità · nessuno scarico in simulazione</strong>{alternative.stockWarnings.map((warning) => <p key={warning.flourId}>{recipeFieldLabel(flourCatalog.find(({ id }) => id === warning.flourId), warning.flourId)}: {warning.reason === 'not-in-pantry' ? 'non presente in dispensa' : warning.reason === 'quantity-unknown' ? `quantità non nota; servono ${amount.format(warning.requiredGrams)} g` : `servono ${amount.format(warning.requiredGrams)} g, disponibili ${amount.format(warning.availableGrams ?? 0)} g`}.</p>)}</div>}
        </details>

        <details className="lab-editor-group"><summary>Piano di fermentazione e disponibilità</summary><div className="lab-editor-grid">
          <label className="field"><span>Strategia</span><select value={scenario.configuration.fermentation.strategy} onChange={(event) => updateFermentation({ strategy: event.target.value as FermentationConfig['strategy'] })}>{strategies.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label className="field"><span>Data e ora di cottura</span><input type="datetime-local" value={timeValue(scenario.configuration.fermentation.bakingAt)} onChange={(event) => updateFermentation({ bakingAt: event.target.value })} /></label>
          <label className="field"><span>Temperatura ambiente · °C</span><input type="number" min="-10" max="45" step="0.5" value={scenario.configuration.fermentation.ambientTemperatureC} onChange={(event) => changeTemperature('ambientTemperatureC', Number(event.target.value))} /></label>
          <label className="field"><span>Temperatura frigorifero · °C</span><input type="number" min="-5" max="20" step="0.5" value={scenario.configuration.fermentation.refrigeratorTemperatureC} onChange={(event) => changeTemperature('refrigeratorTemperatureC', Number(event.target.value))} /></label>
          <label className="field"><span>Impasto misurato · °C</span><input type="number" min="-10" max="50" step="0.5" value={scenario.configuration.fermentation.measuredDoughTemperatureC ?? ''} placeholder="Non indicata" onChange={(event) => changeTemperature('measuredDoughTemperatureC', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
          <label className="field"><span>Durata piano · ore</span><input type="number" min="0" step="1" value={Math.floor(duration / 60)} onChange={(event) => updateFermentation({ totalDurationMinutes: Number(event.target.value) * 60 + duration % 60 })} /></label>
          <label className="field"><span>Durata residua · minuti</span><input type="number" min="0" max="59" step="5" value={duration % 60} onChange={(event) => updateFermentation({ totalDurationMinutes: Math.floor(duration / 60) * 60 + Number(event.target.value) })} /></label>
        </div>
          <div className="lab-phase-editor"><h3>Durata e blocco delle fasi</h3>{scenario.configuration.fermentation.phases.map((phase) => <div className="lab-phase-edit-row" key={`${scenario.id}-${scenario.updatedAt}-${phase.id}`}><label className="field"><span>{phaseLabel(phase.type)} · minuti</span><input type="number" min={phase.minimumDurationMinutes ?? 0} max={phase.maximumDurationMinutes} step="5" defaultValue={phase.durationMinutes} onBlur={(event) => { const durationMinutes = Number(event.currentTarget.value); if (durationMinutes !== phase.durationMinutes) changePhaseDuration(phase.id, durationMinutes) }} /></label><label className="check-line"><input type="checkbox" checked={phase.boundaryLocked === true} onChange={(event) => changePhaseLock(phase.id, event.target.checked)} /><span>Blocca orario</span></label></div>)}</div>
          <label className="check-line lab-availability-toggle"><input type="checkbox" checked={scenario.configuration.fermentation.availability.avoidRestHours} onChange={(event) => updateFermentation({ availability: { avoidRestHours: event.target.checked } })} /><span>Rispetta le mie ore di indisponibilità</span></label>
          <div className="lab-editor-grid lab-availability-times"><label className="field"><span>Non disponibile dalle</span><input type="time" value={scenario.configuration.fermentation.availability.unavailableStart} onChange={(event) => updateFermentation({ availability: { unavailableStart: event.target.value } })} /></label><label className="field"><span>Non disponibile alle</span><input type="time" value={scenario.configuration.fermentation.availability.unavailableEnd} onChange={(event) => updateFermentation({ availability: { unavailableEnd: event.target.value } })} /></label></div>
          <label className="field lab-duration-total"><span>Durata totale</span><strong>{formatDuration(duration)}</strong></label>
          <button className="button button-outline lab-optimize" type="button" onClick={() => { if (!alternative.schedule.candidate) return; updateFermentation({ phases: alternative.schedule.candidate.phases, plannedStartAt: alternative.schedule.candidate.plannedStartAt, bakingAt: alternative.schedule.candidate.bakingAt }) }} disabled={!alternative.schedule.feasible || !scenario.configuration.fermentation.availability.avoidRestHours}><Check size={16} /> Applica gli orari pratici allo scenario</button>
        </details>
      </article>
    </div>

    <section className="lab-comparison-section"><div className="section-heading"><div><p className="eyebrow">RIFERIMENTO ↔ {scenario.name.toUpperCase()}</p><h2>Confronto dosi</h2></div><span className="lab-category-badge lab-class-exact">Calcolo esatto</span></div>
      {comparison.ingredients.length ? <div className="lab-difference-list">{comparison.ingredients.map((row) => <div className="lab-difference-row" key={row.ingredient}><strong>{row.ingredient.startsWith('farina:') ? recipeFieldLabel(flourCatalog.find(({ id }) => `farina:${id}` === row.ingredient), row.ingredient.slice(7)) : row.ingredient}</strong><span><small>Riferimento</small>{row.baseline === null ? 'n.d.' : `${amount.format(row.baseline)} g`}</span><span><small>{scenario.name}</small>{row.alternative === null ? 'n.d.' : `${amount.format(row.alternative)} g`}</span><span className={`${classificationClass(row.classification)} ${row.difference && row.difference > 0 ? 'lab-delta-positive' : row.difference && row.difference < 0 ? 'lab-delta-negative' : ''}`}><small>Differenza · {row.classification}</small>{row.difference === null ? 'n.d.' : `${row.difference > 0 ? '+' : ''}${amount.format(row.difference)} g`}</span></div>)}</div> : <p className="lab-empty-result">Inserisci una miscela valida per confrontare le dosi.</p>}
      <div className="lab-property-comparison"><PropertyPanel label="W · indicatore grezzo" baseline={comparison.baseline.blendProperties.w} alternative={comparison.alternative.blendProperties.w} digits={0} /><PropertyPanel label="P/L · indicatore grezzo" baseline={comparison.baseline.blendProperties.pl} alternative={comparison.alternative.blendProperties.pl} digits={2} /><PropertyPanel label="Proteine · valori forniti" baseline={comparison.baseline.blendProperties.protein} alternative={comparison.alternative.blendProperties.protein} digits={1} suffix="%" /></div>
      <p className="lab-science-note">W e P/L ponderati sono stime aritmetiche approssimative, non misure né proprietà validate della miscela. Le farine possono interagire in modo non lineare; W da solo non determina la durata di fermentazione. Lievia non prevede volume, completamento biologico, gusto o qualità della pizza. Il modello empirico del lievito è non calibrato: nessuna dose predittiva viene mostrata.</p>
      {comparison.uncertainty.length > 0 && <div className="lab-warning-list"><strong>Avvertenze del piano e dei dati</strong>{comparison.uncertainty.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    </section>

    <section className="lab-comparison-section"><div className="section-heading"><div><p className="eyebrow">VINCOLI PRATICI · NON OTTIMIZZAZIONE BIOLOGICA</p><h2>Orari e fasi</h2></div></div>
      <div className="lab-schedule-grid"><ScheduleCard label={`Riferimento · ${session.baselineName}`} result={baseline} /><ScheduleCard label={`Scenario · ${scenario.name}`} result={alternative} /></div>
      <div className="lab-phase-differences">{comparison.phaseDurations.map((phase) => <div className="lab-phase-difference" key={phase.phaseId}><strong>{phase.label}</strong><span>{formatDuration(phase.baselineMinutes)}</span><span>{formatDuration(phase.alternativeMinutes)}</span><span>{phase.deltaMinutes > 0 ? '+' : ''}{formatDuration(Math.abs(phase.deltaMinutes))}{phase.deltaMinutes < 0 ? ' in meno' : phase.deltaMinutes > 0 ? ' in più' : ''}</span></div>)}</div>
      {comparison.phaseChanges.length > 0 && <div className="lab-manual-operations"><h3>Operazioni manuali e disponibilità</h3>{comparison.phaseChanges.map((phase) => <p key={phase.phaseId}><strong>{phase.label}</strong> · riferimento {formatDate(phase.baselineStart)} · scenario {formatDate(phase.alternativeStart)} · {phase.deltaMinutes > 0 ? '+' : ''}{phase.deltaMinutes} min</p>)}</div>}
      <p className="lab-science-note">Il verificatore controlla solo la fattibilità degli orari delle operazioni manuali, le ore di indisponibilità e i lock impostati. Un piano praticabile non è per questo biologicamente ottimale.</p>
    </section>

    <section className="lab-actions"><button className="button button-outline" type="button" onClick={saveAsNewRecipe}><Save size={16} /> Salva come nuova ricetta</button><button className="button button-primary" type="button" onClick={applyAsDraft}><ArrowRight size={16} /> Applica scenario</button></section>
    {message && <p className="lab-message" role="status">{message}</p>}
    <footer className="page-foot"><span>LIEVIA LAB · CONFRONTO SCENARI</span><span>IPOTESI LOCALI · NESSUNO SCARICO DISPENSA</span></footer>
  </div>
}

function IngredientSummary({ result, flours }: { result: ReturnType<typeof calculateScenario>; flours: Flour[] }) {
  if (!result.dough) return <p className="lab-empty-result">Calcolo non disponibile: {result.calculationError}</p>
  const total = result.dough.totalDoughWeight
  const metrics = [
    ['Farina', result.dough.flourWeight], ['Acqua', result.dough.waterWeight], ['Sale', result.dough.saltWeight],
    ['Olio', result.dough.oilWeight], ['Lievito', result.dough.yeastWeight], ['Impasto totale', total],
  ] as const
  return <div className="lab-ingredient-summary"><div className="lab-summary-title"><span>Dosi · <span className="lab-category-badge lab-class-exact">calcolo esatto</span></span><strong>{amount.format(total)} g</strong></div><div className="lab-summary-metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{amount.format(value)} g</strong></span>)}</div><ul>{result.dough.flourQuantities.map((item) => <li key={item.flourId}>{recipeFieldLabel(flours.find(({ id }) => id === item.flourId), item.flourId)} · {percent.format(item.percentage)}% · {amount.format(item.weight)} g</li>)}</ul></div>
}

function BlendSummary({ configuration, flours }: { configuration: RecipeConfiguration; flours: Flour[] }) {
  const properties = deriveBlendPropertyRanges(configuration.flourBlend, flours)
  const missing = missingBlendTechnicalData(configuration.flourBlend, flours)
  return <div className="lab-blend-summary"><h3>Miscela e dati disponibili</h3>{configuration.flourBlend.map((item, index) => { const flour = flours.find(({ id }) => id === item.flourId); const values = flourProperties(flour); return <p key={`${index}-${item.flourId}`}>{recipeFieldLabel(flour, item.flourId)} · {percent.format(item.percentage)}% · W {values.w} · P/L {values.pl} · proteine {values.protein}</p> })}<small>{missing.length ? `Dati mancanti: ${missing.map(({ flourName, fields }) => `${flourName} (${fields.join(', ')})`).join('; ')}.` : 'I campi tecnici riportati sono disponibili nelle fonti o nei profili personali.'}</small><div><span>W ponderato {formatRange(properties.w?.min, properties.w?.max)} · stima aritmetica</span><span>P/L ponderato {formatRange(properties.pl?.min, properties.pl?.max, 2)} · stima aritmetica</span></div></div>
}

function ScheduleSummary({ result }: { result: ReturnType<typeof calculateScenario> }) {
  const schedule = result.schedule.candidate ?? result.schedule.current
  return <div className="lab-schedule-summary"><div className="lab-schedule-title"><h3>Piano · {formatDuration(schedule.totalDurationMinutes)}</h3><span className={result.schedule.feasible ? 'lab-schedule-ok' : 'lab-schedule-conflict'}>{result.schedule.validation.status}</span></div><FermentationTimeline config={schedule} compact /><p>Cottura · {formatDate(schedule.bakingAt)}</p>{result.schedule.conflicts.map((conflict) => <p className="lab-schedule-conflict" role="alert" key={conflict}>{conflict}</p>)}{result.schedule.validation.uncertainty.map((warning) => <p className="lab-schedule-conflict" key={warning}>{warning}</p>)}</div>
}

function ScheduleCard({ label, result }: { label: string; result: ReturnType<typeof calculateScenario> }) {
  return <article className="lab-schedule-card"><h3>{label}</h3><ScheduleSummary result={result} /></article>
}

function PropertyPanel({ label, baseline, alternative, digits, suffix = '' }: { label: string; baseline: { min: number; max: number } | undefined; alternative: { min: number; max: number } | undefined; digits: number; suffix?: string }) {
  return <div className="lab-property-cell"><strong>{label}</strong><span><small>Riferimento · stima aritmetica</small>{baseline ? `${formatRange(baseline.min, baseline.max, digits)}${suffix}` : 'Informazione insufficiente'}</span><span><small>Scenario · stima aritmetica</small>{alternative ? `${formatRange(alternative.min, alternative.max, digits)}${suffix}` : 'Informazione insufficiente'}</span></div>
}