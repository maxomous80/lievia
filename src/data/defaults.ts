import type { Flour, PizzaStyle, Recipe, RecipeDraft } from '../models'

export const DEMO_FLOURS: Flour[] = [
  {
    id: 'demo-00',
    brand: 'Profilo dimostrativo',
    name: 'Tipo 00 da pizza',
    flourType: 'Tipo 00',
    hydrationNotes: 'Profilo generico: adatta l’idratazione alla scheda del produttore.',
    isDemo: true,
  },
  {
    id: 'demo-0',
    brand: 'Profilo dimostrativo',
    name: 'Tipo 0 versatile',
    flourType: 'Tipo 0',
    hydrationNotes: 'Profilo generico: osserva l’assorbimento durante l’impasto.',
    isDemo: true,
  },
  {
    id: 'demo-1',
    brand: 'Profilo dimostrativo',
    name: 'Tipo 1 rustica',
    flourType: 'Tipo 1',
    hydrationNotes: 'Profilo generico: la crusca può modificare l’assorbimento.',
    isDemo: true,
  },
  {
    id: 'demo-integrale',
    brand: 'Profilo dimostrativo',
    name: 'Integrale',
    flourType: 'Integrale',
    hydrationNotes: 'Profilo generico: regola l’acqua in base alla macinazione.',
    isDemo: true,
  },
  {
    id: 'demo-semola',
    brand: 'Profilo dimostrativo',
    name: 'Semola rimacinata',
    flourType: 'Semola rimacinata',
    hydrationNotes: 'Profilo generico: verifica la capacità di assorbimento.',
    isDemo: true,
  },
]

export const STYLE_OPTIONS: Array<{ id: PizzaStyle; label: string }> = [
  { id: 'napoletana', label: 'Napoletana' },
  { id: 'contemporanea', label: 'Contemporanea' },
  { id: 'romana', label: 'Romana' },
  { id: 'teglia', label: 'In teglia' },
  { id: 'padellino', label: 'Al padellino' },
  { id: 'focaccia', label: 'Focaccia' },
  { id: 'personalizzato', label: 'Personalizzato' },
]

export const STYLE_DEFAULTS: Record<PizzaStyle, { hydrationPct: number; saltPct: number; oilPct: number }> = {
  napoletana: { hydrationPct: 62, saltPct: 2.8, oilPct: 0 },
  contemporanea: { hydrationPct: 70, saltPct: 2.8, oilPct: 0.5 },
  romana: { hydrationPct: 58, saltPct: 2.7, oilPct: 0 },
  teglia: { hydrationPct: 80, saltPct: 2.5, oilPct: 2 },
  padellino: { hydrationPct: 65, saltPct: 2.8, oilPct: 1.5 },
  focaccia: { hydrationPct: 75, saltPct: 2.5, oilPct: 4 },
  personalizzato: { hydrationPct: 65, saltPct: 2.8, oilPct: 0 },
}

export function createDefaultDraft(flourId = DEMO_FLOURS[0].id): RecipeDraft {
  return {
    name: '',
    style: 'contemporanea',
    ballCount: 4,
    ballWeight: 250,
    useTotalWeight: false,
    useAreaWeight: false,
    panShape: 'rect',
    hydrationPct: STYLE_DEFAULTS.contemporanea.hydrationPct,
    saltPct: STYLE_DEFAULTS.contemporanea.saltPct,
    oilPct: STYLE_DEFAULTS.contemporanea.oilPct,
    yeastType: 'fresh',
    yeastPct: 0.2,
    maltPct: 0,
    sugarPct: 0,
    flourBlend: [{ flourId, percentage: 100 }],
    doughWeightPerArea: 5000,
  }
}

export function createSampleRecipe(): Recipe {
  const now = new Date().toISOString()
  return {
    ...createDefaultDraft(),
    id: 'sample-contemporanea',
    name: 'La contemporanea di casa',
    ballCount: 4,
    ballWeight: 250,
    hydrationPct: 68,
    saltPct: 2.8,
    oilPct: 0.5,
    yeastPct: 0.15,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}