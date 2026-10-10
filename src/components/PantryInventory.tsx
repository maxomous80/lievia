import { PackageOpen, Trash2, Wheat } from 'lucide-react'
import { useState } from 'react'
import type { Flour } from '../models'
import type { PantryEntry } from '../domain/flours/pantry'

interface PantryInventoryProps {
  entries: PantryEntry[]
  flours: Flour[]
  onUpdate: (flourId: string, changes: Partial<Pick<PantryEntry, 'quantityGrams' | 'notes'>>) => void
  onRemove: (flourId: string) => void
}

function formatRange(min: number | null, max: number | null) {
  if (min === null || max === null) return '—'
  const format = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(value)
  return min === max ? format(min) : `${format(min)}–${format(max)}`
}

function technicalData(flour: Flour | undefined) {
  if (!flour) return { w: '—', pl: '—', protein: '—' }
  const source = flour.officialSource
  return {
    w: source ? formatRange(source.wMin, source.wMax) : flour.strengthW === undefined ? '—' : formatRange(flour.strengthW, flour.strengthW),
    pl: source ? formatRange(source.plMin, source.plMax) : flour.plRatio === undefined ? '—' : formatRange(flour.plRatio, flour.plRatio),
    protein: source?.proteinPercent !== undefined && source?.proteinPercent !== null
      ? `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(source.proteinPercent)}%`
      : flour.proteinPct === undefined ? '—' : `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(flour.proteinPct)}%`,
  }
}

export function PantryInventory({ entries, flours, onUpdate, onRemove }: PantryInventoryProps) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [sort, setSort] = useState<'brand' | 'name' | 'w'>('brand')
  const flourById = new Map(flours.map((flour) => [flour.id, flour]))
  const types = [...new Set(entries.flatMap(({ flourId }) => {
    const flour = flourById.get(flourId)
    return flour ? [flour.flourType] : []
  }))].sort((left, right) => left.localeCompare(right, 'it'))
  const visible = entries.filter((entry) => {
    const flour = flourById.get(entry.flourId)
    const searchable = `${flour?.brand ?? ''} ${flour?.name ?? ''} ${entry.flourId}`.toLocaleLowerCase('it')
    return searchable.includes(query.trim().toLocaleLowerCase('it')) && (!type || flour?.flourType === type)
  }).sort((left, right) => {
    const leftFlour = flourById.get(left.flourId)
    const rightFlour = flourById.get(right.flourId)
    if (sort === 'name') return (leftFlour?.name ?? left.flourId).localeCompare(rightFlour?.name ?? right.flourId, 'it')
    if (sort === 'w') return (leftFlour?.officialSource?.wMin ?? leftFlour?.strengthW ?? Number.POSITIVE_INFINITY) -
      (rightFlour?.officialSource?.wMin ?? rightFlour?.strengthW ?? Number.POSITIVE_INFINITY)
    return (leftFlour?.brand ?? '').localeCompare(rightFlour?.brand ?? '', 'it') ||
      (leftFlour?.name ?? '').localeCompare(rightFlour?.name ?? '', 'it')
  })

  return <>
    {entries.length > 0 && <div className="pantry-filters"><label className="field"><span>Cerca produttore o prodotto</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca nella dispensa" /></label><label className="field"><span>Tipo</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="">Tutti i tipi</option>{types.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="field"><span>Ordina per</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="brand">Produttore</option><option value="name">Prodotto</option><option value="w">W disponibile</option></select></label></div>}
    {entries.length === 0 ? <div className="empty-inline"><PackageOpen size={24} /><span>La dispensa è vuota.</span><span>Aggiungi farine dal catalogo o dalla raccolta personalizzata.</span></div> : visible.length === 0 ? <div className="empty-inline"><span>Nessuna farina corrisponde ai filtri.</span></div> : <div className="pantry-list">{visible.map((entry) => {
      const flour = flourById.get(entry.flourId)
      const values = technicalData(flour)
      const kind = flour?.productKind === 'commercial-blend' ? 'miscela commerciale' : flour?.productKind === 'prepared-mix' ? 'preparato' : flour?.isDemo ? 'profilo demo' : 'farina'
      const quantityValue = entry.quantityGrams === null ? '' : String(entry.quantityGrams)
      return <article className="pantry-row" key={entry.flourId}>
        <div className="custom-flour-icon"><Wheat size={20} /></div>
        <div className="pantry-product"><strong>{flour ? `${flour.brand} · ${flour.name}` : 'Farina non presente nel catalogo attuale'}</strong><span>{flour ? `${flour.flourType} · ${kind}` : `ID conservato: ${entry.flourId}`}</span><span className="pantry-technical">W {values.w} · P/L {values.pl} · proteine {values.protein}</span>{flour?.officialSource && <a href={flour.officialSource.source.url} target="_blank" rel="noreferrer">Fonte del produttore · {flour.officialSource.source.checkedOn ?? flour.officialSource.source.accessed}</a>}</div>
        <label className="field pantry-quantity"><span>Quantità disponibile</span><div className="input-with-unit"><input aria-label={`Quantità disponibile ${flour?.name ?? entry.flourId} in grammi`} type="number" min="0" step="1" value={quantityValue} placeholder="Non nota" onChange={(event) => {
          const raw = event.target.value
          if (!raw.trim()) onUpdate(entry.flourId, { quantityGrams: null })
          else {
            const grams = Number(raw)
            if (Number.isFinite(grams) && grams >= 0) onUpdate(entry.flourId, { quantityGrams: grams })
          }
        }} /><small>g</small></div></label>
        <label className="field pantry-notes"><span>Note personali</span><input value={entry.notes} onChange={(event) => onUpdate(entry.flourId, { notes: event.target.value })} placeholder="Lotto, apertura, conservazione…" /></label>
        <button className="icon-button danger-icon" type="button" aria-label={`Rimuovi ${flour?.name ?? 'farina'} dalla dispensa`} title="Rimuovi dalla dispensa" onClick={() => onRemove(entry.flourId)}><Trash2 size={17} /></button>
      </article>
    })}</div>}
  </>
}
