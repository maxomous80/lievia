import { Check, CircleHelp, Pencil, Plus, Save, Trash2, Wheat, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAppData } from '../context/useAppData'
import { OfficialFlourCatalogue } from '../components/OfficialFlourCatalogue'
import { ARCHIVED_OFFICIAL_FLOURS } from '../data/officialFlours'
import type { Flour } from '../models'

interface FlourFields {
  brand: string
  name: string
  flourType: string
  strengthW: string
  plRatio: string
  proteinPct: string
  hydrationNotes: string
  technicalDataSource: string
}

const emptyFields: FlourFields = { brand: '', name: '', flourType: '', strengthW: '', plRatio: '', proteinPct: '', hydrationNotes: '', technicalDataSource: '' }

function formatOptional(value: number | undefined, suffix = '') {
  return value === undefined ? '—' : `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(value)}${suffix}`
}

export function FlourLibrary() {
  const { flourCatalog, saveFlour, deleteFlour } = useAppData()
  const [fields, setFields] = useState<FlourFields>(emptyFields)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  function beginEdit(flour: Flour) {
    setEditingId(flour.id)
    setFields({
      brand: flour.brand,
      name: flour.name,
      flourType: flour.flourType,
      strengthW: flour.strengthW?.toString() ?? '',
      plRatio: flour.plRatio?.toString() ?? '',
      proteinPct: flour.proteinPct?.toString() ?? '',
      hydrationNotes: flour.hydrationNotes,
      technicalDataSource: flour.technicalDataSource ?? '',
    })
    setError('')
    setSaved(false)
    document.querySelector('#form-farina')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function resetForm() {
    setFields(emptyFields)
    setEditingId(null)
    setError('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericFields = [fields.strengthW, fields.plRatio, fields.proteinPct].filter(Boolean)
    if (numericFields.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) {
      setError('Inserisci solo valori numerici validi e non negativi.')
      return
    }
    if (!fields.brand.trim() || !fields.name.trim() || !fields.flourType.trim()) {
      setError('Compila marca, nome commerciale e tipo di farina.')
      return
    }
    const optionalNumber = (value: string) => value.trim() === '' ? undefined : Number(value)
    saveFlour({
      id: editingId ?? crypto.randomUUID(),
      brand: fields.brand.trim(),
      name: fields.name.trim(),
      flourType: fields.flourType.trim(),
      strengthW: optionalNumber(fields.strengthW),
      plRatio: optionalNumber(fields.plRatio),
      proteinPct: optionalNumber(fields.proteinPct),
      hydrationNotes: fields.hydrationNotes.trim(),
      technicalDataSource: fields.technicalDataSource.trim() || undefined,
      isDemo: false,
    })
    setSaved(true)
    setError('')
    resetForm()
    setSaved(true)
  }

  const custom = flourCatalog.filter((flour) => !flour.isDemo && !flour.officialSource)
  const demos = flourCatalog.filter((flour) => flour.isDemo)
  const official = flourCatalog.filter((flour) => flour.officialSource)
  return (
    <div className="page-stack">
      <section className="page-intro-row"><div><p className="eyebrow">CONOSCI I TUOI INGREDIENTI</p><h1>La dispensa</h1><p className="intro-copy">Le farine che usi, i dati che raccogli, le miscele che immagini.</p></div><a href="#form-farina" className="button button-primary"><Plus size={17} /> Aggiungi farina</a></section>
      <div className="demo-note"><CircleHelp size={17} /><p>I prodotti commerciali sono seed read-only basati sulle fonti indicate. Range e valori mancanti restano quelli dichiarati dai produttori; i profili demo non rappresentano prodotti commerciali.</p></div>
      <section className="flour-section"><div className="section-heading"><div><p className="eyebrow">INCLUSI IN LIEVIA</p><h2>Profili dimostrativi <span className="inline-count">{demos.length}</span></h2></div></div><div className="flour-catalog-grid">
        {demos.map((flour, index) => <article className="flour-card demo-flour-card" key={flour.id}><div className="flour-card-top"><span className={`flour-number shade-${index}`}>0{index + 1}</span><span className="demo-tag">PROFILO DEMO</span></div><h3>{flour.name}</h3><p className="flour-brand">{flour.brand} · {flour.flourType}</p><p className="flour-notes">{flour.hydrationNotes}</p><div className="flour-properties"><span><small>W</small> n.d.</span><span><small>P/L</small> n.d.</span><span><small>Proteine</small> n.d.</span></div></article>)}
      </div></section>
      <OfficialFlourCatalogue flours={official} archivedFlours={ARCHIVED_OFFICIAL_FLOURS} />
      <section className="flour-section"><div className="section-heading"><div><p className="eyebrow">SALVATE SU QUESTO DISPOSITIVO</p><h2>Le mie farine <span className="inline-count">{custom.length}</span></h2></div></div>
        {custom.length > 0 ? <div className="custom-flour-list">{custom.map((flour) => <article className="custom-flour-row" key={flour.id}><div className="custom-flour-icon"><Wheat size={20} /></div><div className="custom-flour-info"><strong>{flour.name}</strong><span>{flour.brand} · {flour.flourType}</span></div><div className="custom-flour-values"><span><small>W</small>{formatOptional(flour.strengthW)}</span><span><small>P/L</small>{formatOptional(flour.plRatio)}</span><span><small>Prot.</small>{formatOptional(flour.proteinPct, '%')}</span></div><div className="custom-flour-actions"><button className="icon-button" type="button" title="Modifica" aria-label={`Modifica ${flour.name}`} onClick={() => beginEdit(flour)}><Pencil size={16} /></button><button className="icon-button danger-icon" type="button" title="Elimina" aria-label={`Elimina ${flour.name}`} onClick={() => { if (window.confirm(`Eliminare “${flour.name}”?`)) deleteFlour(flour.id) }}><Trash2 size={16} /></button></div></article>)}</div> : <div className="empty-inline"><span>La tua raccolta inizia da qui.</span><span>Le schede personalizzate restano solo su questo dispositivo.</span></div>}
      </section>
      <section className="flour-form-section" id="form-farina"><div className="section-heading"><div><p className="eyebrow">{editingId ? 'AGGIORNA SCHEDA' : 'NUOVA SCHEDA'}</p><h2>{editingId ? 'Modifica farina' : 'Aggiungi una farina'}</h2></div>{editingId && <button className="icon-button" onClick={resetForm} type="button" aria-label="Annulla modifica"><X size={17} /></button>}</div>
        <form className="flour-form" onSubmit={submit}>
          <label className="field"><span>Marca</span><input value={fields.brand} onChange={(event) => setFields({ ...fields, brand: event.target.value })} placeholder="Es. Molino…" required /></label>
          <label className="field"><span>Nome commerciale</span><input value={fields.name} onChange={(event) => setFields({ ...fields, name: event.target.value })} placeholder="Nome riportato sulla confezione" required /></label>
          <label className="field"><span>Tipo di farina</span><input value={fields.flourType} onChange={(event) => setFields({ ...fields, flourType: event.target.value })} placeholder="Es. Tipo 0, integrale…" required /></label>
          <label className="field"><span>Forza W <small>facoltativa</small></span><input type="number" min="0" step="1" value={fields.strengthW} onChange={(event) => setFields({ ...fields, strengthW: event.target.value })} placeholder="—" /></label>
          <label className="field"><span>Rapporto P/L <small>facoltativo</small></span><input type="number" min="0" step="0.01" value={fields.plRatio} onChange={(event) => setFields({ ...fields, plRatio: event.target.value })} placeholder="—" /></label>
          <label className="field"><span>Proteine % <small>facoltative</small></span><input type="number" min="0" step="0.1" value={fields.proteinPct} onChange={(event) => setFields({ ...fields, proteinPct: event.target.value })} placeholder="—" /></label>
          <label className="field field-wide"><span>Note sulla capacità di idratazione</span><textarea value={fields.hydrationNotes} onChange={(event) => setFields({ ...fields, hydrationNotes: event.target.value })} placeholder="Annota come reagisce nei tuoi impasti…" rows={2} /></label>
          <label className="field field-wide"><span>Fonte dei dati tecnici <small>facoltativa</small></span><input value={fields.technicalDataSource} onChange={(event) => setFields({ ...fields, technicalDataSource: event.target.value })} placeholder="Es. scheda tecnica del produttore" /></label>
          <div className="form-bottom">{error && <p className="form-error" role="alert">{error}</p>}{saved && <p className="form-success"><Check size={15} /> Scheda salvata</p>}<button type="submit" className="button button-primary"><Save size={16} /> {editingId ? 'Salva modifiche' : 'Salva farina'}</button></div>
        </form>
      </section>
      <footer className="page-foot"><span>LIEVIA · LA DISPENSA</span><span>DATI TECNICI INSERITI DA TE</span></footer>
    </div>
  )
}