import { useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, Check, CircleHelp, FlaskConical, RotateCcw, Send, Undo2, Wheat } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppData } from '../context/useAppData'
import { createDefaultDraft, STYLE_OPTIONS } from '../data/defaults'
import { createDefaultFermentationConfig, formatDuration, reanchorExpiredSchedule, STRATEGY_LABELS } from '../domain/fermentation/schedule'
import { calculateScenario, createRecipeConfiguration, recipeToConfiguration, type RecipeConfiguration } from '../domain/lab/scenarios'
import { createConversation, resetConversation, submitConversationRequest, undoConversationChange } from '../domain/naturalLanguage/conversation'
import { deterministicItalianInterpreter } from '../domain/naturalLanguage/deterministicItalianInterpreter'
import type { NaturalLanguageChoice } from '../domain/naturalLanguage/types'

const examples = [
  'Voglio fare 6 panetti da 250 grammi, idratazione 70%.',
  'Prova 48 ore in frigorifero a 5 gradi e cuoci tra tre giorni alle 20:30.',
  'Usa il 30% di Caputo Nuvola e completa con la farina che ho in dispensa.',
]
const grams = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 })

const fieldLabels: Record<string, string> = {
  style: 'Stile', ballCount: 'Numero di panetti', ballWeight: 'Peso per panetto', totalDoughWeight: 'Peso totale',
  hydrationPct: 'Idratazione', saltPct: 'Sale', oilPct: 'Olio', yeastPct: 'Lievito', yeastType: 'Tipo di lievito',
  flourBlend: 'Miscela di farine', 'fermentation.strategy': 'Strategia', 'fermentation.totalDurationMinutes': 'Durata',
  'fermentation.bakingAt': 'Cottura', 'fermentation.ambientTemperatureC': 'Temperatura ambiente',
  'fermentation.refrigeratorTemperatureC': 'Temperatura frigorifero', 'fermentation.measuredDoughTemperatureC': 'Temperatura impasto',
  'fermentation.availability': 'Disponibilità',
}

function configurationFromRecipe(recipe: Parameters<typeof recipeToConfiguration>[0] | undefined): { configuration: RecipeConfiguration; scheduleRefreshed: boolean } {
  const now = new Date()
  const fermentation = createDefaultFermentationConfig(now)
  if (!recipe) return { configuration: createRecipeConfiguration({ ...createDefaultDraft(), name: 'Nuova proposta' }, fermentation), scheduleRefreshed: false }
  const configuration = recipeToConfiguration(recipe, fermentation)
  const refreshedFermentation = reanchorExpiredSchedule(configuration.fermentation, now, fermentation.bakingAt)
  return {
    configuration: { ...configuration, fermentation: refreshedFermentation },
    scheduleRefreshed: refreshedFermentation !== configuration.fermentation,
  }
}

function fieldValue(configuration: RecipeConfiguration, field: string, flours: ReturnType<typeof useAppData>['flourCatalog']): string {
  if (field === 'style') return STYLE_OPTIONS.find(({ id }) => id === configuration.style)?.label ?? configuration.style
  if (field === 'ballCount') return `${configuration.ballCount} panetti`
  if (field === 'ballWeight') return `${configuration.ballWeight} g`
  if (field === 'totalDoughWeight') return `${configuration.totalDoughWeight ?? 0} g`
  if (field === 'hydrationPct') return `${configuration.hydrationPct}%`
  if (field === 'saltPct') return `${configuration.saltPct}%`
  if (field === 'oilPct') return `${configuration.oilPct}%`
  if (field === 'yeastPct') return `${configuration.yeastPct}% · ${configuration.yeastType === 'fresh' ? 'fresco' : configuration.yeastType === 'instant-dry' ? 'secco istantaneo' : 'secco attivo'}`
  if (field === 'yeastType') return configuration.yeastType === 'fresh' ? 'Fresco' : configuration.yeastType === 'instant-dry' ? 'Secco istantaneo' : 'Secco attivo'
  if (field === 'flourBlend') return configuration.flourBlend.map(({ flourId, percentage }) => `${flours.find(({ id }) => id === flourId)?.name ?? 'Farina non disponibile'} ${percentage}%`).join(' · ')
  if (field === 'fermentation.strategy') return STRATEGY_LABELS[configuration.fermentation.strategy]
  if (field === 'fermentation.totalDurationMinutes') return formatDuration(configuration.fermentation.totalDurationMinutes)
  if (field === 'fermentation.bakingAt') return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(configuration.fermentation.bakingAt))
  if (field === 'fermentation.ambientTemperatureC') return `${configuration.fermentation.ambientTemperatureC} °C`
  if (field === 'fermentation.refrigeratorTemperatureC') return `${configuration.fermentation.refrigeratorTemperatureC} °C`
  if (field === 'fermentation.measuredDoughTemperatureC') return `${configuration.fermentation.measuredDoughTemperatureC ?? 'Non indicata'} °C`
  if (field === 'fermentation.availability') return configuration.fermentation.availability.avoidRestHours ? `Operazioni evitate ${configuration.fermentation.availability.unavailableStart}–${configuration.fermentation.availability.unavailableEnd}` : 'Nessun vincolo aggiuntivo'
  return 'Valore mantenuto'
}

export function AskLievia() {
  const { recipes, flourCatalog, pantryEntries } = useAppData()
  const navigate = useNavigate()
  const [initialLoad] = useState(() => configurationFromRecipe(recipes[0]))
  const [selectedRecipeId, setSelectedRecipeId] = useState(recipes[0]?.id ?? '')
  const [configuration, setConfiguration] = useState(initialLoad.configuration)
  const [conversation, setConversation] = useState(() => createConversation(configuration))
  const [request, setRequest] = useState('')
  const [notice, setNotice] = useState(initialLoad.scheduleRefreshed ? 'La data di fermentazione salvata era trascorsa: ho spostato il piano in avanti mantenendo durata e fasi. La ricetta salvata non è stata modificata.' : '')
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome')
  const preview = useMemo(() => calculateScenario('chiedi-proposta', 'Proposta conversazionale', conversation.configuration, flourCatalog, pantryEntries), [conversation.configuration, flourCatalog, pantryEntries])
  const changed = conversation.undoStack.length > 0 && JSON.stringify(conversation.configuration) !== JSON.stringify(conversation.baseline)
  const interpretation = conversation.lastInterpretation
  const explicitRows = conversation.explicitFields.map((field) => ({ field, label: fieldLabels[field] ?? field, value: fieldValue(conversation.configuration, field, flourCatalog) }))
  const inheritedFields = ['style', 'ballCount', 'ballWeight', 'hydrationPct', 'saltPct', 'oilPct', 'yeastPct', 'flourBlend', 'fermentation.strategy', 'fermentation.totalDurationMinutes', 'fermentation.bakingAt'].filter((field) => !conversation.explicitFields.includes(field))

  function submit(text = request) {
    if (!text.trim()) return
    setConversation((current) => submitConversationRequest(current, text, deterministicItalianInterpreter, {
      flours: flourCatalog,
      pantryEntries,
      now: new Date(),
      timeZone,
    }))
    setRequest('')
    setNotice('')
  }

  function chooseFlour(choice: NaturalLanguageChoice, percentage?: number) {
    submit(percentage === undefined ? `Usa ${choice.label}` : `Usa il ${grams.format(percentage)}% di ${choice.label}`)
  }

  function changeBaseline(recipeId: string) {
    const recipe = recipes.find(({ id }) => id === recipeId)
    const loaded = configurationFromRecipe(recipe)
    const next = loaded.configuration
    setSelectedRecipeId(recipeId)
    setConfiguration(next)
    setConversation(createConversation(next))
    setNotice(loaded.scheduleRefreshed
      ? 'La data di fermentazione salvata era trascorsa: ho spostato il piano in avanti mantenendo durata e fasi. La ricetta salvata non è stata modificata.'
      : 'La proposta è ripartita dai valori della ricetta scelta.')
  }

  function confirmInLab() {
    const name = `Proposta · ${new Date().toLocaleDateString('it-IT')}`
    const sessionId = `chiedi-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
    navigate(`/lab?session=${encodeURIComponent(sessionId)}`, { state: { labBaseline: { sessionId, name, configuration: { ...conversation.configuration, name } } } })
  }

  function confirmInBuilder() {
    if (!preview.schedule.feasible) {
      setNotice('Il piano non è fattibile. Apri la proposta in Lab per rivedere fasi e durata prima di usarla nel calcolatore.')
      return
    }
    navigate('/impasto', { state: { labConfiguration: conversation.configuration } })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submit()
  }

  return (
    <div className="page-stack ask-page">
      <section className="ask-heading">
        <div><p className="eyebrow">INTERPRETAZIONE DETERMINISTICA · NESSUN SERVIZIO ESTERNO</p><h1>Chiedi a Lievia</h1><p className="intro-copy">Descrivi l’impasto o il piano che vuoi modificare. Ogni proposta resta qui finché non la confermi.</p></div>
        <label className="field ask-baseline"><span>Parti da una ricetta</span><select value={selectedRecipeId} onChange={(event) => changeBaseline(event.target.value)}><option value="">Nuovo impasto</option>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>
      </section>

      <div className="ask-layout">
        <section className="ask-conversation" aria-label="Conversazione con Lievia">
          <div className="ask-conversation-top"><div><span className="ask-status"><i />Interprete locale</span><p>Scrivi in italiano, anche più richieste insieme.</p></div><button className="icon-button" type="button" title="Azzera conversazione" aria-label="Azzera conversazione" onClick={() => { setConversation(resetConversation(conversation)); setNotice('Conversazione azzerata. La base è rimasta invariata.'); setRequest('') }}><RotateCcw size={17} /></button></div>
          <div className="ask-examples" aria-label="Esempi"><span>ESEMPI</span>{examples.map((example) => <button key={example} type="button" onClick={() => submit(example)}>{example}</button>)}</div>
          <div className="ask-messages" aria-live="polite" aria-relevant="additions text">
            {conversation.messages.length === 0 && <div className="ask-welcome"><span><Wheat size={19} /></span><div><strong>Da dove partiamo?</strong><p>Puoi cambiare dosi, farine, lievito, temperature e orari di cottura.</p></div></div>}
            {conversation.messages.map((message) => <div className={`ask-message ask-message-${message.role}`} key={message.id}><span>{message.role === 'user' ? 'Tu' : 'Lievia'}</span><p>{message.text}</p></div>)}
          </div>
          <form className="ask-composer" onSubmit={handleSubmit}><label htmlFor="ask-input">La tua richiesta</label><textarea id="ask-input" value={request} onChange={(event) => setRequest(event.target.value)} placeholder="Es. Porta l’idratazione al 70% e sposta la cottura a domani alle 20" rows={3} /><div><small>Valori approssimativi e richieste ambigue richiedono una precisazione.</small><button className="button button-primary" type="submit" disabled={!request.trim()}><Send size={15} /> Invia</button></div></form>
        </section>

        <aside className="ask-preview" aria-label="Anteprima della proposta">
          <div className="ask-preview-heading"><div><p className="eyebrow">ANTEPRIMA CALCOLATA</p><h2>{conversation.configuration.name || 'La tua proposta'}</h2></div><span className="ask-preview-mark"><Check size={14} /> Non salvata</span></div>
          {notice && <p className="ask-notice" role="status">{notice}</p>}
          {interpretation?.ambiguities.map((ambiguity, index) => <section className="ask-clarification" key={`${ambiguity.field}-${index}`}><h3><CircleHelp size={16} />Serve una precisazione</h3><p>{ambiguity.question}</p>{ambiguity.choices?.length ? <div className="ask-choices">{ambiguity.choices.map((choice) => <button type="button" key={choice.id} onClick={() => chooseFlour(choice, ambiguity.choicePercentage)}>{choice.label}{ambiguity.choicePercentage !== undefined && <span>{grams.format(ambiguity.choicePercentage)}%</span>}<ArrowRight size={14} /></button>)}</div> : ambiguity.field === 'flourBlend' && /dispensa/i.test(ambiguity.question) ? <button className="ask-pantry-link" type="button" onClick={() => navigate('/farine')}>Apri la dispensa <ArrowRight size={14} /></button> : null}</section>)}
          {interpretation?.validationErrors.map((issue, index) => <p className="ask-error" role="alert" key={`${issue.field}-${index}`}>{issue.message}</p>)}
          {interpretation?.unsupportedRequests.map((item, index) => <section className="ask-clarification ask-unsupported" key={`${item.text}-${index}`}><h3>Non posso valutarlo</h3><p>{item.explanation}</p><small>{item.suggestion}</small></section>)}
          {explicitRows.length > 0 && <section className="ask-parameter-group"><h3>Richiesti</h3><dl>{explicitRows.map((row) => <div key={row.field}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></section>}
          <section className="ask-parameter-group ask-inherited"><h3>{explicitRows.length ? 'Ereditati dalla ricetta' : 'Valori della ricetta di partenza'}</h3><dl>{inheritedFields.slice(0, 6).map((field) => <div key={field}><dt>{fieldLabels[field] ?? field}</dt><dd>{fieldValue(conversation.configuration, field, flourCatalog)}</dd></div>)}</dl></section>

          {preview.dough ? <>
            <section className="ask-dough-result"><div className="ask-result-title"><h3>Dosi aggiornate</h3><strong>{grams.format(preview.dough.totalDoughWeight)} g</strong></div><p>{conversation.configuration.useTotalWeight ? 'Peso totale richiesto' : `${conversation.configuration.ballCount} panetti da ${grams.format(conversation.configuration.ballWeight)} g`}</p><dl>{preview.dough.flourQuantities.map((item) => <div key={item.flourId}><dt>{flourCatalog.find(({ id }) => id === item.flourId)?.name ?? 'Farina non disponibile'}</dt><dd>{grams.format(item.weight)} g · {grams.format(item.percentage)}%</dd></div>)}{[{ label: 'Farina totale', amount: preview.dough.flourWeight }, { label: 'Acqua', amount: preview.dough.waterWeight }, { label: 'Sale', amount: preview.dough.saltWeight }, { label: 'Olio', amount: preview.dough.oilWeight }, { label: 'Lievito', amount: preview.dough.yeastWeight }, { label: 'Malto', amount: preview.dough.maltWeight }, { label: 'Zucchero', amount: preview.dough.sugarWeight }].filter(({ amount }) => amount > 0).map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{grams.format(item.amount)} g</dd></div>)}</dl></section>
            <section className="ask-schedule"><h3>Piano di fermentazione</h3><p className={preview.schedule.feasible ? 'lab-schedule-ok' : 'lab-schedule-conflict'} role={preview.schedule.feasible ? 'status' : 'alert'}>{preview.schedule.validation.status}</p><p>{STRATEGY_LABELS[conversation.configuration.fermentation.strategy]} · {formatDuration(conversation.configuration.fermentation.totalDurationMinutes)}</p><div><span>Preparazione</span><strong>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(preview.schedule.current.plannedStartAt))}</strong></div>{preview.schedule.operations.map((operation) => <div key={operation.phaseId}><span>{operation.label}</span><strong>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(operation.startAt))}–{new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' }).format(new Date(operation.endAt))}</strong></div>)}<div><span>Cottura</span><strong>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(preview.schedule.current.bakingAt))}</strong></div>{preview.schedule.conflicts.map((conflict) => <small className="lab-schedule-conflict" role="alert" key={conflict}>{conflict}</small>)}{preview.schedule.validation.uncertainty.map((warning) => <small key={warning}>{warning}</small>)}{preview.warnings.slice(0, 2).map((warning) => <small key={warning}>{warning}</small>)}</section>
          </> : <p className="ask-error">{preview.calculationError ?? 'Non riesco a calcolare questa proposta.'}</p>}

          <div className="ask-actions"><button className="button button-outline" type="button" disabled={!conversation.undoStack.length} onClick={() => setConversation(undoConversationChange(conversation))}><Undo2 size={15} /> Annulla modifica</button><button className="button button-outline" type="button" disabled={!changed} onClick={() => { setConversation(resetConversation(conversation)); setNotice('Proposta ripristinata alla ricetta di partenza.') }}><RotateCcw size={15} /> Ripristina base</button></div>
          <div className="ask-confirm"><p>Confermare apre una copia non salvata. Potrai rivederla prima di salvarla.</p><button className="button button-primary" type="button" disabled={!changed || Boolean(interpretation?.ambiguities.length || interpretation?.validationErrors.length || interpretation?.unsupportedRequests.length)} onClick={confirmInLab}><FlaskConical size={15} /> {preview.schedule.feasible ? 'Conferma e apri in Lab' : 'Apri in Lab per correggere'}</button><button className="button button-outline" type="button" disabled={!changed || !preview.schedule.feasible || Boolean(interpretation?.ambiguities.length || interpretation?.validationErrors.length || interpretation?.unsupportedRequests.length)} onClick={confirmInBuilder}><ArrowRight size={15} /> Apri come bozza impasto</button></div>
        </aside>
      </div>
      <footer className="page-foot"><span>INTERPRETAZIONE LOCALE · NESSUN MODELLO AI</span><span>LE RICETTE SALVATE RESTANO INVARIATE</span></footer>
    </div>
  )
}
