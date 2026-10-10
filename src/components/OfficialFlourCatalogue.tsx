import { BadgeAlert, BadgeCheck, ExternalLink, Search } from 'lucide-react'
import { useState } from 'react'
import type { Flour, OfficialFlourSourceRecord } from '../models'

function formatRange(min: number | null, max: number | null, digits = 2) {
  if (min === null || max === null) return 'Non dichiarato'
  const format = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: digits }).format(value)
  return min === max ? format(min) : `${format(min)}–${format(max)}`
}

function missingSpecifications(record: OfficialFlourSourceRecord) {
  return [
    record.flourType === null,
    record.wMin === null || record.wMax === null,
    record.plMin === null || record.plMax === null,
    record.proteinPercent === null,
    record.waterAbsorptionPercent === null,
  ].filter(Boolean).length
}

function matchesWRange(flour: Flour, min: number | undefined, max: number | undefined) {
  if (min === undefined && max === undefined) return true
  const source = flour.officialSource
  if (!source || source.wMin === null || source.wMax === null) return false
  return (min === undefined || source.wMax >= min) && (max === undefined || source.wMin <= max)
}

function matchesProteinRange(flour: Flour, min: number | undefined, max: number | undefined) {
  if (min === undefined && max === undefined) return true
  const protein = flour.officialSource?.proteinPercent
  return protein !== null && protein !== undefined &&
    (min === undefined || protein >= min) && (max === undefined || protein <= max)
}

function parseFilter(value: string) {
  if (!value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function kindLabel(kind: Flour['productKind']) {
  if (kind === 'commercial-blend') return 'Miscela commerciale'
  if (kind === 'prepared-mix') return 'Preparato con ingredienti aggiunti'
  return 'Farina'
}

function brandFilterLabel(brand: string) {
  return brand === 'Mulino Caputo' ? 'Caputo' : brand
}

function verifiedFieldLabel(field: string) {
  const labels: Record<string, string> = {
    name: 'nome', w: 'W', pl: 'P/L', flourType: 'tipo',
    proteinPercent: 'proteine', farinographAbsorptionPercent: 'assorbimento farinografico',
  }
  return labels[field] ?? field
}

export function OfficialFlourCatalogue({ flours, archivedFlours }: { flours: Flour[]; archivedFlours: Flour[] }) {
  const [brand, setBrand] = useState('')
  const [query, setQuery] = useState('')
  const [flourType, setFlourType] = useState('')
  const [wMin, setWMin] = useState('')
  const [wMax, setWMax] = useState('')
  const [proteinMin, setProteinMin] = useState('')
  const [proteinMax, setProteinMax] = useState('')
  const official = flours.filter((flour) => flour.officialSource)
  const brands = [...new Set(official.map(({ brand: flourBrand }) => flourBrand))].sort((a, b) => a.localeCompare(b, 'it'))
  const types = [...new Set(official.map(({ officialSource: record }) => record?.flourType).filter((type): type is string => Boolean(type)))].sort((a, b) => a.localeCompare(b, 'it'))
  const normalizedQuery = query.trim().toLocaleLowerCase('it')
  const visible = official.filter((flour) => {
    const record = flour.officialSource!
    const nameMatches = !normalizedQuery || flour.name.toLocaleLowerCase('it').includes(normalizedQuery)
    const typeMatches = !flourType || (flourType === '__missing' ? record.flourType === null : record.flourType === flourType)
    return (!brand || flour.brand === brand) && nameMatches && typeMatches &&
      matchesWRange(flour, parseFilter(wMin), parseFilter(wMax)) &&
      matchesProteinRange(flour, parseFilter(proteinMin), parseFilter(proteinMax))
  })

  return (
    <section className="flour-section official-catalogue-section">
      <div className="section-heading"><div><p className="eyebrow">DATI DA FONTI DEI PRODUTTORI</p><h2>Catalogo commerciale <span className="inline-count">{official.length}</span></h2></div></div>
      <div className="catalogue-filters" aria-label="Filtri catalogo farine">
        <label className="field catalogue-search"><span>Nome commerciale</span><div className="catalogue-search-input"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca un prodotto" /></div></label>
        <label className="field"><span>Marca</span><select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Tutte le marche</option>{brands.map((item) => <option key={item} value={item}>{brandFilterLabel(item)}</option>)}</select></label>
        <label className="field"><span>Tipo</span><select value={flourType} onChange={(event) => setFlourType(event.target.value)}><option value="">Tutti i tipi</option>{types.map((item) => <option key={item} value={item}>{item}</option>)}<option value="__missing">Non dichiarato</option></select></label>
        <div className="field"><span>W · intervallo</span><div className="catalogue-range-inputs"><input aria-label="W minimo" type="number" min="0" value={wMin} onChange={(event) => setWMin(event.target.value)} placeholder="Da" /><input aria-label="W massimo" type="number" min="0" value={wMax} onChange={(event) => setWMax(event.target.value)} placeholder="A" /></div></div>
        <div className="field"><span>Proteine % · opzionale</span><div className="catalogue-range-inputs"><input aria-label="Proteine minime" type="number" min="0" step="0.1" value={proteinMin} onChange={(event) => setProteinMin(event.target.value)} placeholder="Da" /><input aria-label="Proteine massime" type="number" min="0" step="0.1" value={proteinMax} onChange={(event) => setProteinMax(event.target.value)} placeholder="A" /></div></div>
      </div>
      <p className="catalogue-result-count">{visible.length} prodotti · i filtri W e proteine usano gli intervalli e i valori pubblicati</p>
      {visible.length ? <div className="flour-catalog-grid official-flour-grid">
        {visible.map((flour, index) => {
          const record = flour.officialSource!
          const missing = missingSpecifications(record)
          const typeMatches = !flourType || (flourType === '__missing' ? record.flourType === null : record.flourType === flourType)
          return typeMatches ? <article className="flour-card official-flour-card" key={flour.id}>
            <div className="flour-card-top"><span className={`flour-number shade-${index % 5}`}>{String(index + 1).padStart(2, '0')}</span><span className="official-tag"><BadgeCheck size={13} /> FONTE PRODUTTORE</span></div>
            {record.imageUrl && <img className="official-flour-image" src={record.imageUrl} alt={`${flour.brand} ${flour.name}`} loading="lazy" />}
            <h3>{flour.name}</h3>
            <p className="flour-brand">{flour.brand} · {kindLabel(flour.productKind)} · {record.flourType ?? 'Tipo non dichiarato'}</p>
            <div className="flour-properties official-properties"><span><small>W · intervallo fonte</small>{formatRange(record.wMin, record.wMax, 0)}</span><span><small>P/L · intervallo fonte</small>{formatRange(record.plMin, record.plMax, 2)}</span><span><small>Proteine · fonte</small>{record.proteinPercent === null ? 'Non dichiarate' : `${formatRange(record.proteinPercent, record.proteinPercent, 2)}%`}</span></div>
            <p className="official-verification">Fonte {record.source.type} · consultata il {new Intl.DateTimeFormat('it-IT').format(new Date(`${record.source.checkedOn ?? record.source.accessed}T12:00:00`))} · {missing ? `${missing} specifiche non dichiarate` : 'specifiche disponibili'}</p>
            {flour.productKind === 'prepared-mix' && <p className="prepared-mix-warning">Contiene ingredienti aggiunti: composizione non trattata come farina pura e prodotto escluso dal calcolo farine.</p>}
            <details className="official-spec-details"><summary>Dettagli tecnici e provenienza</summary><dl><div><dt>Assorbimento farinografico · produttore</dt><dd>{record.farinographAbsorptionPercent === null ? 'Non dichiarato' : `${formatRange(record.farinographAbsorptionPercent, record.farinographAbsorptionPercent)}%`}</dd></div><div><dt>Assorbimento acqua dichiarato</dt><dd>{record.waterAbsorptionPercent === null ? 'Non dichiarato' : `${formatRange(record.waterAbsorptionPercent, record.waterAbsorptionPercent)}%`}</dd></div><div><dt>Idratazione ricetta</dt><dd>Parametro separato, definito nella ricetta</dd></div><div><dt>Tipo dichiarato</dt><dd>{record.flourType ?? 'Non dichiarato dal produttore'}</dd></div><div><dt>ID prodotto</dt><dd>{record.id}</dd></div><div><dt>Campi verificati</dt><dd>{record.verifiedFields?.length ? record.verifiedFields.map(verifiedFieldLabel).join(', ') : 'Scheda fonte importata; elenco campi non disponibile'}</dd></div><div><dt>Schema fonte</dt><dd>{record.catalogueSchemaVersion}</dd></div></dl>{record.notes ? <p>{record.notes}</p> : <p>Nessuna nota tecnica pubblicata.</p>}{record.qualityFlags?.map((flag) => <p className="quality-flag" key={flag}>Da verificare: {flag === 'ambiguous_pl_in_source' ? 'dato P/L ambiguo nella fonte' : flag}</p>)}</details>
            <a className="official-source-link" href={record.source.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Fonte ufficiale</a>
          </article> : null
        })}
      </div> : <div className="empty-inline"><span>Nessun prodotto corrisponde ai filtri.</span></div>}
      {archivedFlours.length > 0 && <details className="official-archive"><summary><BadgeAlert size={15} /> Specifiche storiche, non correnti <span className="inline-count">{archivedFlours.length}</span></summary><div className="official-archive-list">{archivedFlours.map((flour) => {
        const record = flour.officialSource!
        const current = official.find((candidate) => candidate.brand === flour.brand && candidate.officialSource?.productIdentity === record.productIdentity)
        return <article className="official-archive-row" key={flour.id}><div><strong>{flour.brand} · {flour.name}</strong><span>{current ? `Specifiche storiche riferite al prodotto corrente “${current.name}”; escluse dal catalogo e dai filtri attuali.` : 'Specifiche storiche conservate separatamente; escluse dal catalogo e dai filtri attuali.'}</span><span>W {formatRange(record.wMin, record.wMax, 0)} · P/L {formatRange(record.plMin, record.plMax)}</span></div><a className="official-source-link" href={record.source.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Fonte storica</a></article>
      })}</div></details>}
    </section>
  )
}