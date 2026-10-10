import { ArrowRight, Plus, Wheat } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAppData } from '../context/useAppData'
import { STYLE_OPTIONS } from '../data/defaults'
import { calculateDough } from '../lib/calculator'

const grams = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })

export function Dashboard() {
  const { recipes, flourCatalog } = useAppData()
  const recentRecipes = recipes.slice(0, 3)

  return (
    <div className="page-stack dashboard-page">
      <section className="welcome-line">
        <div><p className="eyebrow">BENVENUTO NEL TUO LABORATORIO</p><h1>La prossima pizza<br className="desktop-break" /> comincia da qui.</h1></div>
        <p className="welcome-copy">Appunti precisi, farine da conoscere<br className="desktop-break" /> e impasti fatti a modo tuo.</p>
      </section>
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="hero-overline">LIEVIA · THE SCIENCE OF DOUGH</span>
          <h2>Ogni impasto<br />ha la sua storia.</h2>
          <p>Componi la tua miscela, dosa ogni ingrediente e conserva le ricette che vuoi rifare.</p>
          <Link to="/impasto" className="button button-light">Crea il tuo impasto <ArrowRight size={17} /></Link>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="art-ring art-ring-outer" /><div className="art-ring art-ring-inner" /><div className="dough-disc"><span className="dough-flour" /><span className="dough-mark mark-one" /><span className="dough-mark mark-two" /><span className="dough-mark mark-three" /></div><span className="art-caption">FARINA · ACQUA · TEMPO</span></div>
        <span className="hero-index">01 / IL PROCESSO</span>
      </section>
      <section className="dashboard-grid">
        <div className="section-block recipe-preview">
          <div className="section-heading"><div><p className="eyebrow">DAL TUO RICETTARIO</p><h2>Ricette recenti</h2></div><Link to="/ricette" className="text-link">Tutte le ricette <ArrowRight size={15} /></Link></div>
          {recentRecipes.length > 0 ? <div className="recent-list">{recentRecipes.map((recipe) => {
            const dough = calculateDough(recipe)
            const style = STYLE_OPTIONS.find((option) => option.id === recipe.style)?.label ?? 'Personalizzato'
            return <Link to={`/impasto?edit=${recipe.id}`} className="recent-row" key={recipe.id}>
              <span className="recipe-thumb"><Wheat size={20} strokeWidth={1.6} /></span><span className="recent-main"><strong>{recipe.name}</strong><small>{style} · {recipe.useTotalWeight ? 'peso totale' : `${recipe.ballCount} palline`}</small></span><span className="recent-weight">{grams.format(dough.targetDoughWeight)}<small>g</small></span><ArrowRight className="recent-arrow" size={16} />
            </Link>
          })}</div> : <div className="empty-state"><p>Il ricettario è ancora vuoto.</p><Link to="/impasto" className="text-link">Crea la prima ricetta <ArrowRight size={15} /></Link></div>}
        </div>
        <div className="section-block flour-preview">
          <div className="section-heading"><div><p className="eyebrow">LA TUA DISPENSA</p><h2>Farine a portata di mano</h2></div><Link to="/farine" className="round-link" aria-label="Apri le farine"><ArrowRight size={17} /></Link></div>
          <div className="flour-count"><span className="flour-count-number">{String(flourCatalog.length).padStart(2, '0')}</span><span>profili disponibili</span></div>
          <div className="flour-preview-list">{flourCatalog.slice(0, 3).map((flour) => <div className="flour-preview-row" key={flour.id}><span className="flour-dot" /><span>{flour.name}</span><small>{flour.isDemo ? 'DEMO' : flour.flourType}</small></div>)}</div>
          <Link to="/farine" className="text-link flour-manage-link"><Plus size={15} /> Gestisci la dispensa</Link>
        </div>
      </section>
      <footer className="page-foot"><span>LIEVIA · THE SCIENCE OF DOUGH</span><span>IL GUSTO DELLA PRECISIONE</span></footer>
    </div>
  )
}