import { Check, Download, FileUp, NotebookPen, Save } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppData } from '../context/useAppData'
import { createImmutableExperimentSnapshot, isDoughOutcome, type DoughCondition, type DoughOutcome } from '../domain/feedback/outcomes'
import { calculateDough } from '../lib/calculator'
import { serializeBackup } from '../lib/dataBackup'
import { createDefaultFermentationConfig, updateTotalDuration } from '../domain/fermentation/schedule'
import { createRecipeConfiguration } from '../domain/lab/scenarios'
import type { Recipe } from '../models'

const conditionLabels: Record<DoughCondition, string> = {
  underproofed: 'Sotto-lievitato',
  acceptable: 'Adeguato per la cottura',
  overproofed: 'Sovra-lievitato',
}

function localDateTimeValue(date = new Date()) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return adjusted.toISOString().slice(0, 16)
}

function recipeYeastGrams(recipe: Recipe | undefined) {
  if (!recipe) return 0
  try { return Number(calculateDough(recipe).yeastWeight.toFixed(3)) } catch { return 0 }
}

export function Feedback() {
  const { recipes, outcomes, flourCatalog, customFlours, pantryEntries, labWorkspace, temperatureSamples, calibrationRecords, estimatorConfiguration, addOutcome, importBackup } = useAppData()
  const [searchParams] = useSearchParams()
  const [recipeId, setRecipeId] = useState(searchParams.get('ricetta') ?? recipes[0]?.id ?? '')
  const selectedRecipe = recipes.find((recipe) => recipe.id === recipeId)
  const [preparedAt, setPreparedAt] = useState(localDateTimeValue())
  const [actualBakeAt, setActualBakeAt] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(selectedRecipe?.fermentation?.totalDurationMinutes ?? 0)
  const [roomTemperatureC, setRoomTemperatureC] = useState(selectedRecipe?.fermentation?.ambientTemperatureC ?? 22)
  const [refrigeratorTemperatureC, setRefrigeratorTemperatureC] = useState(selectedRecipe?.fermentation?.refrigeratorTemperatureC ?? 5)
  const [measuredDoughTemperatureC, setMeasuredDoughTemperatureC] = useState(selectedRecipe?.fermentation?.measuredDoughTemperatureC?.toString() ?? '')
  const [yeastQuantityGrams, setYeastQuantityGrams] = useState(recipeYeastGrams(selectedRecipe))
  const [yeastManufacturer, setYeastManufacturer] = useState('')
  const [yeastLot, setYeastLot] = useState('')
  const [condition, setCondition] = useState<DoughCondition>('acceptable')
  const [score, setScore] = useState('')
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function selectRecipe(id: string) {
    const recipe = recipes.find((item) => item.id === id)
    setRecipeId(id)
    setDurationMinutes(recipe?.fermentation?.totalDurationMinutes ?? 0)
    setRoomTemperatureC(recipe?.fermentation?.ambientTemperatureC ?? 22)
    setRefrigeratorTemperatureC(recipe?.fermentation?.refrigeratorTemperatureC ?? 5)
    setMeasuredDoughTemperatureC(recipe?.fermentation?.measuredDoughTemperatureC?.toString() ?? '')
    setYeastQuantityGrams(recipeYeastGrams(recipe))
    setYeastManufacturer('')
    setYeastLot('')
  }

  function saveOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const preparationInstant = new Date(preparedAt)
    if (!Number.isFinite(preparationInstant.getTime())) {
      setError('Inserisci una data di preparazione valida.')
      return
    }
    let experimentSnapshot
    try {
      if (!selectedRecipe) throw new TypeError('Seleziona una ricetta salvata per creare una fotografia sperimentale.')
      const dough = calculateDough(selectedRecipe)
      const flourById = new Map(flourCatalog.map((flour) => [flour.id, flour]))
      const calculatedFlours = selectedRecipe.flourBlend.map((blend) => ({
        productId: blend.flourId,
        brand: flourById.get(blend.flourId)?.brand ?? null,
        name: flourById.get(blend.flourId)?.name ?? null,
        flourType: flourById.get(blend.flourId)?.flourType ?? null,
        wMin: flourById.get(blend.flourId)?.officialSource?.wMin ?? flourById.get(blend.flourId)?.strengthW ?? null,
        wMax: flourById.get(blend.flourId)?.officialSource?.wMax ?? flourById.get(blend.flourId)?.strengthW ?? null,
        plMin: flourById.get(blend.flourId)?.officialSource?.plMin ?? flourById.get(blend.flourId)?.plRatio ?? null,
        plMax: flourById.get(blend.flourId)?.officialSource?.plMax ?? flourById.get(blend.flourId)?.plRatio ?? null,
        proteinPercent: flourById.get(blend.flourId)?.officialSource?.proteinPercent ?? flourById.get(blend.flourId)?.proteinPct ?? null,
        source: flourById.get(blend.flourId)?.officialSource?.source.url ?? flourById.get(blend.flourId)?.technicalDataSource ?? null,
      }))
      const actualYeastPercentage = dough.flourWeight > 0 ? yeastQuantityGrams / dough.flourWeight * 100 : null
      const ingredients = [
        { id: 'farina', massGrams: dough.flourWeight, bakerPercentage: 100 },
        ...dough.flourQuantities.map((flour) => ({ id: `farina:${flour.flourId}`, massGrams: flour.weight, bakerPercentage: flour.percentage, flourPercentage: flour.percentage })),
        { id: 'acqua', massGrams: dough.waterWeight, bakerPercentage: selectedRecipe.hydrationPct },
        { id: 'sale', massGrams: dough.saltWeight, bakerPercentage: selectedRecipe.saltPct },
        { id: 'olio', massGrams: dough.oilWeight, bakerPercentage: selectedRecipe.oilPct },
        { id: 'lievito', massGrams: yeastQuantityGrams, bakerPercentage: actualYeastPercentage },
        { id: 'malto', massGrams: dough.maltWeight, bakerPercentage: selectedRecipe.maltPct },
        { id: 'zucchero', massGrams: dough.sugarWeight, bakerPercentage: selectedRecipe.sugarPct },
      ]
      const fermentation = selectedRecipe.fermentation ?? updateTotalDuration({
        ...createDefaultFermentationConfig(preparationInstant),
        ambientTemperatureC: roomTemperatureC,
        refrigeratorTemperatureC,
        measuredDoughTemperatureC: measuredDoughTemperatureC === '' ? undefined : Number(measuredDoughTemperatureC),
      }, durationMinutes)
      const explicitBakeAt = actualBakeAt ? new Date(actualBakeAt) : null
      const observedEnd = explicitBakeAt && Number.isFinite(explicitBakeAt.getTime())
        ? explicitBakeAt.getTime()
        : preparationInstant.getTime() + durationMinutes * 60_000
      experimentSnapshot = createImmutableExperimentSnapshot({
        schemaVersion: 1,
        observedAt: preparationInstant.toISOString(),
        recipeConfiguration: createRecipeConfiguration({ ...selectedRecipe, fermentation }, fermentation),
        ingredients: ingredients.map((ingredient) => ({ ...ingredient, bakerPercentage: ingredient.bakerPercentage ?? null })),
        selectedFlours: calculatedFlours,
        yeast: { type: selectedRecipe.yeastType, quantityGrams: yeastQuantityGrams, manufacturer: yeastManufacturer || undefined, lot: yeastLot || undefined },
        doughMassGrams: dough.targetDoughWeight,
        doughMassSource: 'recipe-calculation',
        hydrationPct: selectedRecipe.hydrationPct,
        saltPct: selectedRecipe.saltPct,
        plannedPhases: fermentation.phases.map((phase) => ({ phaseId: phase.id, type: phase.type, startAt: phase.startAt, endAt: phase.endAt, durationMinutes: phase.durationMinutes, environment: phase.environment, temperatureC: phase.temperatureC })),
        actualOperations: [
          ...(fermentation.phases.some(({ type }) => type === 'mixing') ? [{ phaseId: fermentation.phases.find(({ type }) => type === 'mixing')!.id, startedAt: preparationInstant.toISOString() }] : []),
          ...(explicitBakeAt && Number.isFinite(explicitBakeAt.getTime()) && fermentation.phases.some(({ type }) => type === 'baking') ? [{ phaseId: fermentation.phases.find(({ type }) => type === 'baking')!.id, endedAt: explicitBakeAt.toISOString() }] : []),
        ],
        initialDoughTemperatureC: measuredDoughTemperatureC === '' ? null : Number(measuredDoughTemperatureC),
        measuredInitialDoughTemperatureC: measuredDoughTemperatureC === '' ? null : Number(measuredDoughTemperatureC),
        ambientTemperatureC: roomTemperatureC,
        refrigeratorTemperatureC,
        temperatureSamples: temperatureSamples.filter((sample) => Date.parse(sample.at) >= preparationInstant.getTime() && Date.parse(sample.at) <= observedEnd).map((sample) => ({ ...sample })),
        provenance: { recipeId: selectedRecipe.id, capturedFrom: 'saved-recipe', userProvidedMeasurementsOnly: true },
        units: { temperature: '°C', mass: 'g', time: 'min', dimensions: 'mm' },
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile creare la fotografia sperimentale.')
      return
    }
    const outcome: DoughOutcome = {
      version: 1,
      id: crypto.randomUUID(),
      recipeId,
      preparedAt: preparationInstant.toISOString(),
      actualFermentationDurationMinutes: Math.round(durationMinutes),
      actualRoomTemperatureC: roomTemperatureC,
      actualRefrigeratorTemperatureC: refrigeratorTemperatureC,
      measuredDoughTemperatureC: measuredDoughTemperatureC === '' ? undefined : Number(measuredDoughTemperatureC),
      yeastType: selectedRecipe?.fermentation?.yeastType ?? selectedRecipe?.yeastType ?? 'fresh',
      actualYeastQuantityGrams: yeastQuantityGrams,
      doughCondition: condition,
      subjectiveScore: score === '' ? undefined : Number(score),
      notes: notes.trim(),
      experimentSnapshot,
    }
    if (!isDoughOutcome(outcome)) {
      setError('Controlla data, temperature, durata, quantità e valutazione inserite.')
      return
    }
    addOutcome(outcome)
    setMessage('Esito registrato su questo dispositivo.')
    setPreparedAt(localDateTimeValue())
    setActualBakeAt('')
    setScore('')
    setNotes('')
  }

  function exportData() {
    const serialized = serializeBackup({ recipes, customFlours, outcomes, calibrationRecords, pantryEntries, estimatorConfiguration, labWorkspace, temperatureSamples })
    const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `lievia-backup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setMessage('Backup JSON scaricato.')
    setError('')
  }

  async function importData(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (file.size > 5_000_000) {
      setError('Il file supera il limite di 5 MB.')
      return
    }
    try {
      const added = importBackup(await file.text())
      setMessage(`Importazione completata: ${added.recipes} ricette, ${added.customFlours} farine, ${added.pantryEntries} voci dispensa, ${added.labSessions} sessioni Lab, ${added.outcomes} esiti, ${added.temperatureSamples} misure termiche e ${added.calibrationRecords} record di calibrazione nuovi. Le impostazioni locali esistenti sono state mantenute.`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile importare il file selezionato.')
      setMessage('')
    }
  }

  const sortedOutcomes = [...outcomes].sort((first, second) => second.preparedAt.localeCompare(first.preparedAt))
  return (
    <div className="page-stack feedback-page">
      <section className="page-intro-row">
        <div><p className="eyebrow">OSSERVA, ANNOTA, CONFRONTA</p><h1>Esiti e dati</h1><p className="intro-copy">Le tue osservazioni restano separate dalle ricette e non modificano modelli o dosaggi.</p></div>
        <div className="backup-actions"><button type="button" className="button button-outline" onClick={exportData}><Download size={15} /> Esporta backup</button><label className="button button-outline"><FileUp size={15} /> Importa backup<input type="file" accept="application/json,.json" onChange={importData} /></label></div>
      </section>

      {(message || error) && <p className={error ? 'form-error feedback-notice' : 'form-success feedback-notice'} role={error ? 'alert' : 'status'}>{!error && <Check size={15} />}{error || message}</p>}

      <section className="feedback-form-section">
        <div className="section-heading"><div><p className="eyebrow">DOPO LA COTTURA</p><h2>Registra un esito</h2></div><NotebookPen size={20} /></div>
        {recipes.length ? <form className="feedback-form" onSubmit={saveOutcome}>
          <label className="field field-wide"><span>Ricetta</span><select value={recipeId} onChange={(event) => selectRecipe(event.target.value)} required>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>
          <label className="field"><span>Data di preparazione</span><input type="datetime-local" value={preparedAt} onChange={(event) => setPreparedAt(event.target.value)} required /></label>
          <label className="field"><span>Ora cottura effettiva <small>facoltativa</small></span><input type="datetime-local" value={actualBakeAt} onChange={(event) => setActualBakeAt(event.target.value)} /></label>
          <label className="field"><span>Durata effettiva</span><div className="input-with-unit"><input type="number" min="0" step="0.25" value={durationMinutes / 60} onChange={(event) => setDurationMinutes(Math.round(Number(event.target.value) * 60))} required /><small>ore</small></div></label>
          <label className="field"><span>Temperatura ambiente</span><div className="input-with-unit"><input type="number" min="-30" max="60" step="0.5" value={roomTemperatureC} onChange={(event) => setRoomTemperatureC(Number(event.target.value))} required /><small>°C</small></div></label>
          <label className="field"><span>Temperatura frigorifero</span><div className="input-with-unit"><input type="number" min="-30" max="40" step="0.5" value={refrigeratorTemperatureC} onChange={(event) => setRefrigeratorTemperatureC(Number(event.target.value))} required /><small>°C</small></div></label>
          <label className="field"><span>Temperatura impasto misurata <small>facoltativa</small></span><div className="input-with-unit"><input type="number" min="-10" max="50" step="0.5" value={measuredDoughTemperatureC} onChange={(event) => setMeasuredDoughTemperatureC(event.target.value)} placeholder="—" /><small>°C</small></div></label>
          <label className="field"><span>Quantità reale di lievito</span><div className="input-with-unit"><input type="number" min="0" step="0.001" value={yeastQuantityGrams} onChange={(event) => setYeastQuantityGrams(Number(event.target.value))} required /><small>g</small></div></label>
          <details className="experiment-metadata field-wide"><summary>Metadati sperimentali facoltativi</summary><div className="experiment-metadata-grid"><label className="field"><span>Produttore lievito</span><input value={yeastManufacturer} onChange={(event) => setYeastManufacturer(event.target.value)} /></label><label className="field"><span>Lotto lievito</span><input value={yeastLot} onChange={(event) => setYeastLot(event.target.value)} /></label></div><p>La fotografia conserva i valori della ricetta selezionata e i dati inseriti ora; i campi assenti restano non misurati.</p></details>
          <label className="field"><span>Condizione prima della cottura</span><select value={condition} onChange={(event) => setCondition(event.target.value as DoughCondition)}><option value="underproofed">Sotto-lievitato</option><option value="acceptable">Adeguato per la cottura</option><option value="overproofed">Sovra-lievitato</option></select></label>
          <label className="field"><span>Valutazione personale <small>facoltativa</small></span><select value={score} onChange={(event) => setScore(event.target.value)}><option value="">Non assegnata</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
          <label className="field field-wide"><span>Note personali <small>facoltative</small></span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Aspetto, tenuta, profumo, lavorabilità…" /></label>
          <div className="form-bottom"><span>I dati sono salvati solo nel LocalStorage di questo browser.</span><button type="submit" className="button button-primary"><Save size={15} /> Registra esito</button></div>
        </form> : <div className="empty-inline"><span>Salva una ricetta prima di registrare un esito.</span><Link className="text-link" to="/impasto">Crea un impasto</Link></div>}
      </section>

      <section className="outcome-history">
        <div className="section-heading"><div><p className="eyebrow">MEMORIA LOCALE</p><h2>Esiti precedenti <span className="inline-count">{outcomes.length}</span></h2></div></div>
        {sortedOutcomes.length ? <div className="outcome-list">{sortedOutcomes.map((outcome) => {
          const recipe = recipes.find((item) => item.id === outcome.recipeId)
          return <article className="outcome-row" key={outcome.id}>
            <div className={`outcome-condition condition-${outcome.doughCondition}`}><span>{conditionLabels[outcome.doughCondition]}</span><small>{new Date(outcome.preparedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
            <div className="outcome-main"><strong>{outcome.experimentSnapshot?.recipeConfiguration.name ?? recipe?.name ?? 'Ricetta non più presente'}</strong><span>{Math.floor(outcome.actualFermentationDurationMinutes / 60)} h {outcome.actualFermentationDurationMinutes % 60} min · {outcome.actualYeastQuantityGrams.toLocaleString('it-IT', { maximumFractionDigits: 3 })} g lievito</span><small>Ambiente {outcome.actualRoomTemperatureC} °C · frigorifero {outcome.actualRefrigeratorTemperatureC} °C{outcome.measuredDoughTemperatureC === undefined ? '' : ` · impasto ${outcome.measuredDoughTemperatureC} °C`} · {outcome.experimentSnapshot ? 'fotografia immutabile presente' : 'esito legacy senza fotografia'}</small>{outcome.notes && <p>{outcome.notes}</p>}</div>
            {outcome.subjectiveScore !== undefined && <strong className="outcome-score">{outcome.subjectiveScore}/5</strong>}
          </article>
        })}</div> : <div className="empty-inline"><span>Nessun esito registrato.</span><span>Le osservazioni non addestrano automaticamente alcun modello.</span></div>}
      </section>
      <section className="calibration-status"><div><p className="eyebrow">TRASPARENZA DEL MODELLO</p><h2>Calibrazione futura</h2><p>Stato attuale: lievito non calibrato. Gli esiti raccolti ({outcomes.length}) restano osservazioni personali e non modificano coefficienti. Una futura calibrazione richiederà un protocollo, fonti tracciabili e una valutazione separata.</p><small>Record di calibrazione importati: {calibrationRecords.length}</small></div></section>
      <footer className="page-foot"><span>LIEVIA · OSSERVAZIONI PERSONALI</span><span>NON SONO DATI DI CALIBRAZIONE</span></footer>
    </div>
  )
}