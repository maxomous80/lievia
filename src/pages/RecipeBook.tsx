import { ArrowRight, ClipboardList, Copy, Plus, Trash2, Wheat } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppData } from '../context/useAppData'
import { STYLE_OPTIONS } from '../data/defaults'
import { calculateDough } from '../lib/calculator'

const number = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })

export function RecipeBook() {
  const { recipes, deleteRecipe } = useAppData()
  const navigate = useNavigate()
  return (
    <div className="page-stack">
      <section className="page-intro-row"><div><p className="eyebrow">LE TUE CREAZIONI</p><h1>Il ricettario</h1><p className="intro-copy">Tutti gli impasti che hai salvato, pronti per tornare in tavola.</p></div><Link to="/impasto" className="button button-primary"><Plus size={17} /> Nuova ricetta</Link></section>
      <div className="recipe-book-meta"><span>{recipes.length} {recipes.length === 1 ? 'ricetta' : 'ricette'}</span><span>Salvate in questo dispositivo</span></div>
      {recipes.length > 0 ? <div className="recipe-card-list">{recipes.map((recipe) => {
        const dough = calculateDough(recipe)
        const style = STYLE_OPTIONS.find((option) => option.id === recipe.style)?.label ?? 'Personalizzato'
        const date = new Date(recipe.updatedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
        return <article className="recipe-card" key={recipe.id}>
          <div className="recipe-card-emblem"><Wheat size={24} strokeWidth={1.5} /></div>
          <div className="recipe-card-main"><p className="eyebrow">{style.toUpperCase()}</p><h2>{recipe.name}</h2><p className="recipe-card-note">Ultima modifica · {date}</p></div>
          <div className="recipe-stats"><div><strong>{recipe.hydrationPct}%</strong><small>idratazione</small></div><div><strong>{recipe.useTotalWeight ? 'Totale' : recipe.ballCount}</strong><small>{recipe.useTotalWeight ? 'peso unico' : 'palline'}</small></div><div><strong>{number.format(dough.targetDoughWeight)}<em>g</em></strong><small>impasto</small></div></div>
          <div className="recipe-actions"><Link to={`/impasto?edit=${recipe.id}`} className="button button-outline">Apri ricetta <ArrowRight size={15} /></Link><Link to={`/esiti?ricetta=${recipe.id}`} className="icon-button" aria-label={`Registra esito per ${recipe.name}`} title="Registra esito"><ClipboardList size={16} /></Link><button type="button" className="icon-button" aria-label={`Duplica ${recipe.name}`} title="Duplica" onClick={() => navigate(`/impasto?duplicate=${recipe.id}`)}><Copy size={17} /></button><button type="button" className="icon-button danger-icon" aria-label={`Elimina ${recipe.name}`} title="Elimina" onClick={() => { if (window.confirm(`Eliminare “${recipe.name}”?`)) deleteRecipe(recipe.id) }}><Trash2 size={17} /></button></div>
        </article>
      })}</div> : <div className="empty-state large-empty"><span className="empty-icon"><Wheat size={26} /></span><h2>Una pagina ancora da riempire.</h2><p>Le ricette che salverai resteranno qui, a portata di mano.</p><Link to="/impasto" className="button button-primary"><Plus size={16} /> Crea una ricetta</Link></div>}
      <footer className="page-foot"><span>LIEVIA · IL TUO RICETTARIO</span><span>DATI SALVATI IN LOCALE</span></footer>
    </div>
  )
}