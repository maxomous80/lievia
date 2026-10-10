import type { Flour, FlourBlendItem, PizzaStyle, Recipe, RecipeDraft, YeastType } from '../../models'
import type { FermentationConfig, FermentationPhase, FermentationPhaseType, FermentationStrategy, TemperatureEnvironment, UserAvailability } from '../fermentation/types'
import { getFlourGuidance, getTemperatureGuidance } from '../fermentation/guidance'
import { isManualPhase, optimizeFermentationSchedule } from '../fermentation/availability'
import { PHASE_LABELS, setScheduleAnchor, updateTotalDuration } from '../fermentation/schedule'
import { deriveBlendPropertyRanges, missingBlendTechnicalData } from '../flours/blendProperties'
import { getStockWarnings, type PantryEntry, type PantryStockWarning } from '../flours/pantry'
import { calculateDough, type DoughResult } from '../../lib/calculator'

export interface RecipeConfiguration extends RecipeDraft {
  fermentation: FermentationConfig
}

export type FermentationPatch = Partial<Omit<FermentationConfig, 'availability' | 'phases'>> & {
  availability?: Partial<UserAvailability>
  phases?: FermentationPhase[]
}

export interface RecipePatch {
  name?: string
  style?: PizzaStyle
  ballCount?: number
  ballWeight?: number
  totalDoughWeight?: number
  useTotalWeight?: boolean
  useAreaWeight?: boolean
  panShape?: 'rect' | 'round'
  hydrationPct?: number
  saltPct?: number
  oilPct?: number
  yeastType?: YeastType
  yeastPct?: number
  maltPct?: number
  sugarPct?: number
  flourBlend?: FlourBlendItem[]
  panWidth?: number
  panLength?: number
  panDiameter?: number
  doughWeightPerArea?: number
  fermentation?: FermentationPatch
}

export interface PatchIssue {
  field: string
  message: string
}

export type PatchResult =
  | { ok: true; configuration: RecipeConfiguration; issues: [] }
  | { ok: false; configuration: null; issues: PatchIssue[] }

export type ResultClassification = 'calcolo esatto' | 'stima aritmetica' | 'stima empirica' | 'informazione insufficiente'

export interface ScenarioCalculation {
  scenarioId: string
  name: string
  configuration: RecipeConfiguration
  dough: DoughResult | null
  calculationError?: string
  blendProperties: ReturnType<typeof deriveBlendPropertyRanges>
  missingFlourData: ReturnType<typeof missingBlendTechnicalData>
  stockWarnings: PantryStockWarning[]
  warnings: string[]
  schedule: {
    current: FermentationConfig
    feasible: boolean
    candidate?: FermentationConfig
    conflicts: string[]
    operations: Array<{ phaseId: string; label: string; startAt: string; endAt: string }>
  }
}

export interface IngredientDifference {
  ingredient: string
  baseline: number | null
  alternative: number | null
  difference: number | null
  classification: ResultClassification
}

export interface ScenarioComparison {
  baseline: ScenarioCalculation
  alternative: ScenarioCalculation
  ingredients: IngredientDifference[]
  blendChanged: boolean
  phaseDurations: Array<{ phaseId: string; label: string; baselineMinutes: number; alternativeMinutes: number; deltaMinutes: number }>
  phaseChanges: Array<{ phaseId: string; label: string; baselineStart: string; alternativeStart: string; deltaMinutes: number }>
  uncertainty: string[]
}

const styles = new Set<PizzaStyle>(['napoletana', 'contemporanea', 'romana', 'teglia', 'padellino', 'focaccia', 'personalizzato'])
const yeastTypes = new Set<YeastType>(['fresh', 'instant-dry', 'active-dry'])
const strategies = new Set<FermentationStrategy>(['room-temperature', 'refrigerated', 'combined', 'custom'])
const phaseTypes = new Set<FermentationPhaseType>(['mixing', 'initial-rest', 'bulk-fermentation', 'folding', 'dividing', 'refrigeration', 'final-proof', 'baking'])
const environments = new Set<TemperatureEnvironment>(['ambient', 'dough', 'refrigerator', 'custom'])
const recipeKeys = new Set(['name', 'style', 'ballCount', 'ballWeight', 'totalDoughWeight', 'useTotalWeight', 'useAreaWeight', 'panShape', 'hydrationPct', 'saltPct', 'oilPct', 'yeastType', 'yeastPct', 'maltPct', 'sugarPct', 'flourBlend', 'panWidth', 'panLength', 'panDiameter', 'doughWeightPerArea', 'fermentation'])
const fermentationKeys = new Set(['version', 'strategy', 'timeAnchor', 'totalDurationMinutes', 'plannedStartAt', 'bakingAt', 'ambientTemperatureC', 'measuredDoughTemperatureC', 'refrigeratorTemperatureC', 'targetDoughTemperatureC', 'yeastMode', 'manualYeastUnit', 'yeastType', 'estimatorModelId', 'estimatorModelVersion', 'userYeastDoseOverride', 'planConfirmed', 'availability', 'phases'])

export function createRecipeConfiguration(draft: RecipeDraft, defaultFermentation: FermentationConfig): RecipeConfiguration {
  return cloneRecipeConfiguration({ ...draft, fermentation: draft.fermentation ?? defaultFermentation })
}

export function recipeToConfiguration(recipe: Recipe, defaultFermentation: FermentationConfig): RecipeConfiguration {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, ...draft } = recipe
  return createRecipeConfiguration(draft, defaultFermentation)
}

export function cloneRecipeConfiguration(configuration: RecipeConfiguration): RecipeConfiguration {
  return {
    ...configuration,
    flourBlend: configuration.flourBlend.map((item) => ({ ...item })),
    fermentation: {
      ...configuration.fermentation,
      availability: { ...configuration.fermentation.availability },
      phases: configuration.fermentation.phases.map((phase) => ({ ...phase })),
      userYeastDoseOverride: configuration.fermentation.userYeastDoseOverride
        ? { ...configuration.fermentation.userYeastDoseOverride }
        : undefined,
    },
  }
}

export function validateRecipePatch(current: RecipeConfiguration, value: unknown, flours?: Flour[]): PatchResult {
  const issues: PatchIssue[] = []
  if (!isRecord(value)) return { ok: false, configuration: null, issues: [{ field: 'patch', message: 'La modifica deve essere un oggetto valido.' }] }
  for (const key of Object.keys(value)) if (!recipeKeys.has(key)) issues.push({ field: key, message: 'Campo non riconosciuto.' })

  const numericLimits: Record<string, [number, number]> = {
    ballCount: [1, 100], ballWeight: [1, 10000], totalDoughWeight: [1, 100000],
    hydrationPct: [0, 300], saltPct: [0, 100], oilPct: [0, 100], yeastPct: [0, 100],
    maltPct: [0, 100], sugarPct: [0, 100], panWidth: [0, 300], panLength: [0, 300],
    panDiameter: [0, 300], doughWeightPerArea: [0, 100000],
  }
  for (const [field, [minimum, maximum]] of Object.entries(numericLimits)) {
    const candidate = value[field]
    if (candidate !== undefined && (!isFiniteNumber(candidate) || candidate < minimum || candidate > maximum)) {
      issues.push({ field, message: `Inserisci un valore compreso tra ${minimum} e ${maximum}.` })
    }
  }
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim())) issues.push({ field: 'name', message: 'Il nome non può essere vuoto.' })
  if (value.style !== undefined && !styles.has(value.style as PizzaStyle)) issues.push({ field: 'style', message: 'Lo stile selezionato non è valido.' })
  if (value.yeastType !== undefined && !yeastTypes.has(value.yeastType as YeastType)) issues.push({ field: 'yeastType', message: 'Il tipo di lievito selezionato non è valido.' })
  for (const field of ['useTotalWeight', 'useAreaWeight'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') issues.push({ field, message: 'Selezione non valida.' })
  }
  if (value.panShape !== undefined && value.panShape !== 'rect' && value.panShape !== 'round') issues.push({ field: 'panShape', message: 'La forma del contenitore non è valida.' })
  if (value.flourBlend !== undefined) validateBlend(value.flourBlend, issues, flours)
  if (value.fermentation !== undefined) validateFermentationPatch(value.fermentation, issues)

  if (issues.length) return { ok: false, configuration: null, issues }
  const patch = value as RecipePatch
  const fermentationPatch = patch.fermentation
  const fermentation: FermentationConfig = {
    ...current.fermentation,
    ...fermentationPatch,
    availability: { ...current.fermentation.availability, ...fermentationPatch?.availability },
    phases: fermentationPatch?.phases?.map((phase) => ({ ...phase })) ?? current.fermentation.phases.map((phase) => ({ ...phase })),
  }
  let nextFermentation = fermentation
  try {
    if (fermentationPatch?.totalDurationMinutes !== undefined && fermentationPatch.totalDurationMinutes !== current.fermentation.totalDurationMinutes) {
      nextFermentation = updateTotalDuration(nextFermentation, fermentationPatch.totalDurationMinutes)
    }
    if (fermentationPatch?.bakingAt !== undefined && fermentationPatch.bakingAt !== current.fermentation.bakingAt) {
      nextFermentation = setScheduleAnchor(nextFermentation, 'bake', fermentationPatch.bakingAt)
    } else if (fermentationPatch?.plannedStartAt !== undefined && fermentationPatch.plannedStartAt !== current.fermentation.plannedStartAt) {
      nextFermentation = setScheduleAnchor(nextFermentation, 'start', fermentationPatch.plannedStartAt)
    }
  } catch (error) {
    return { ok: false, configuration: null, issues: [{ field: 'fermentation', message: error instanceof Error ? error.message : 'Il piano non può rispettare le fasi bloccate.' }] }
  }
  if (fermentationPatch?.phases !== undefined) {
    const phasesById = new Map(fermentation.phases.map((phase) => [phase.id, phase]))
    for (const locked of current.fermentation.phases.filter((phase) => phase.boundaryLocked)) {
      const changed = phasesById.get(locked.id)
      if (changed && changed.boundaryLocked !== false && (changed.startAt !== locked.startAt || changed.endAt !== locked.endAt)) {
        return { ok: false, configuration: null, issues: [{ field: 'fermentation.phases', message: `L’operazione bloccata “${PHASE_LABELS[locked.type]}” non può essere spostata senza sbloccarla.` }] }
      }
      if (!changed) return { ok: false, configuration: null, issues: [{ field: 'fermentation.phases', message: `L’operazione bloccata “${PHASE_LABELS[locked.type]}” non può essere rimossa.` }] }
    }
  }
  const next = cloneRecipeConfiguration({ ...current, ...patch, fermentation: nextFermentation })
  if (patch.yeastType !== undefined && fermentationPatch?.yeastType === undefined) next.fermentation.yeastType = patch.yeastType
  if (fermentationPatch?.yeastType !== undefined && patch.yeastType === undefined) next.yeastType = fermentationPatch.yeastType
  if (patch.yeastType !== undefined && fermentationPatch?.yeastType !== undefined && patch.yeastType !== fermentationPatch.yeastType) {
    return { ok: false, configuration: null, issues: [{ field: 'yeastType', message: 'Il tipo di lievito della ricetta e del piano devono coincidere.' }] }
  }
  const fermentationIssues = validateFermentationConfiguration(next.fermentation)
  if (fermentationIssues.length) return { ok: false, configuration: null, issues: fermentationIssues }
  try {
    calculateDough(toDoughInput(next))
  } catch (error) {
    return { ok: false, configuration: null, issues: [{ field: 'ingredients', message: error instanceof Error ? error.message : 'I dati dell’impasto non sono validi.' }] }
  }
  return { ok: true, configuration: next, issues: [] }
}

export function normalizeRecipeConfiguration(value: unknown): RecipeConfiguration | null {
  const required = ['name', 'style', 'ballCount', 'ballWeight', 'useTotalWeight', 'hydrationPct', 'saltPct', 'oilPct', 'yeastType', 'yeastPct', 'maltPct', 'sugarPct', 'flourBlend', 'doughWeightPerArea', 'fermentation']
  if (!isRecord(value) || required.some((key) => !(key in value)) || !Array.isArray(value.flourBlend) || typeof value.yeastType !== 'string' || !isRecord(value.fermentation)) return null
  const baseDraft = {
    name: '', style: 'contemporanea' as const, ballCount: 4, ballWeight: 250, useTotalWeight: false,
    hydrationPct: 65, saltPct: 2.8, oilPct: 0, yeastType: 'fresh' as const, yeastPct: 0.2, maltPct: 0, sugarPct: 0,
    flourBlend: [{ flourId: 'demo-00', percentage: 100 }], doughWeightPerArea: 5000,
  }
  const base = { ...baseDraft, fermentation: value.fermentation as unknown as FermentationConfig }
  const validation = validateRecipePatch(base, value)
  return validation.ok ? validation.configuration : null
}

export function toDoughInput(configuration: RecipeConfiguration) {
  const area = configuration.panShape === 'round'
    ? Math.PI * ((configuration.panDiameter ?? 0) / 2) ** 2
    : (configuration.panWidth ?? 0) * (configuration.panLength ?? 0)
  const areaWeight = area / 10_000 * configuration.doughWeightPerArea
  const useTotalWeight = configuration.useTotalWeight || configuration.useAreaWeight === true
  return {
    ballCount: configuration.ballCount,
    ballWeight: configuration.ballWeight,
    totalDoughWeight: configuration.useAreaWeight ? areaWeight : configuration.totalDoughWeight,
    useTotalWeight,
    hydrationPct: configuration.hydrationPct,
    saltPct: configuration.saltPct,
    oilPct: configuration.oilPct,
    yeastType: configuration.yeastType,
    yeastPct: configuration.yeastPct,
    maltPct: configuration.maltPct,
    sugarPct: configuration.sugarPct,
    flourBlend: configuration.flourBlend,
  }
}

export function calculateScenario(scenarioId: string, name: string, configuration: RecipeConfiguration, flours: Flour[], pantryEntries: PantryEntry[]): ScenarioCalculation {
  let dough: DoughResult | null = null
  let calculationError: string | undefined
  try {
    dough = calculateDough(toDoughInput(configuration))
  } catch (error) {
    calculationError = error instanceof Error ? error.message : 'Calcolo degli ingredienti non disponibile.'
  }
  const blendProperties = deriveBlendPropertyRanges(configuration.flourBlend, flours)
  const missingFlourData = missingBlendTechnicalData(configuration.flourBlend, flours)
  const stockWarnings = dough ? getStockWarnings(pantryEntries, dough.flourQuantities.map(({ flourId, weight }) => ({ flourId, quantityGrams: weight }))) : []
  const guidanceFlours = flours.map((flour) => ({
    id: flour.id, name: flour.name, strengthW: flour.officialSource ? undefined : flour.strengthW,
    strengthWRange: flour.officialSource ? { min: flour.officialSource.wMin, max: flour.officialSource.wMax } : undefined,
    proteinPct: flour.officialSource ? flour.officialSource.proteinPercent ?? undefined : flour.proteinPct,
    isDemo: flour.isDemo,
  }))
  const warnings = [
    ...getTemperatureGuidance(configuration.fermentation),
    ...getFlourGuidance({ blend: configuration.flourBlend, flours: guidanceFlours, durationMinutes: configuration.fermentation.totalDurationMinutes, hydrationPct: configuration.hydrationPct, style: configuration.style }),
  ].map(({ message }) => message)
  const optimization = optimizeFermentationSchedule(configuration.fermentation)
  return {
    scenarioId, name, configuration: cloneRecipeConfiguration(configuration), dough, calculationError,
    blendProperties, missingFlourData, stockWarnings, warnings,
    schedule: {
      current: configuration.fermentation,
      feasible: optimization.ok,
      candidate: optimization.config,
      conflicts: optimization.conflicts,
      operations: (optimization.config ?? configuration.fermentation).phases.filter(isManualPhase).map((phase) => ({
        phaseId: phase.id, label: PHASE_LABELS[phase.type], startAt: phase.startAt, endAt: phase.endAt,
      })),
    },
  }
}

export function compareScenarios(baseline: ScenarioCalculation, alternative: ScenarioCalculation): ScenarioComparison {
  const ingredientValues = (dough: DoughResult | null) => {
    if (!dough) return new Map<string, number>()
    const values = new Map<string, number>([
      ['Farina totale', dough.flourWeight], ['Acqua', dough.waterWeight], ['Sale', dough.saltWeight],
      ['Olio', dough.oilWeight], ['Lievito', dough.yeastWeight], ['Malto', dough.maltWeight],
      ['Zucchero', dough.sugarWeight], ['Impasto totale', dough.totalDoughWeight],
    ])
    for (const { flourId, weight } of dough.flourQuantities) {
      const key = `farina:${flourId}`
      values.set(key, (values.get(key) ?? 0) + weight)
    }
    return values
  }
  const first = ingredientValues(baseline.dough)
  const second = ingredientValues(alternative.dough)
  const ingredients = [...new Set([...first.keys(), ...second.keys()])].map((key) => {
    const baselineValue = first.get(key) ?? null
    const alternativeValue = second.get(key) ?? null
    const label = key.startsWith('farina:')
      ? `Farina · ${baseline.configuration.flourBlend.find(({ flourId }) => `farina:${flourId}` === key)?.flourId ?? alternative.configuration.flourBlend.find(({ flourId }) => `farina:${flourId}` === key)?.flourId}`
      : key
    return { ingredient: label, baseline: baselineValue, alternative: alternativeValue, difference: baselineValue === null || alternativeValue === null ? null : alternativeValue - baselineValue, classification: baselineValue === null || alternativeValue === null ? 'informazione insufficiente' as const : 'calcolo esatto' as const }
  })
  const alternativeOperations = new Map(alternative.schedule.operations.map((phase) => [phase.phaseId, phase]))
  const phaseChanges = baseline.schedule.operations.flatMap((phase) => {
    const changed = alternativeOperations.get(phase.phaseId)
    if (!changed) return []
    const deltaMinutes = Math.round((Date.parse(changed.startAt) - Date.parse(phase.startAt)) / 60_000)
    return [{ phaseId: phase.phaseId, label: phase.label, baselineStart: phase.startAt, alternativeStart: changed.startAt, deltaMinutes }]
  })
  const baselinePhases = baseline.schedule.candidate ?? baseline.schedule.current
  const alternativePhases = alternative.schedule.candidate ?? alternative.schedule.current
  const alternativeByPhase = new Map(alternativePhases.phases.map((phase) => [phase.id, phase]))
  const phaseDurations = baselinePhases.phases.flatMap((phase) => {
    const changed = alternativeByPhase.get(phase.id)
    if (!changed) return []
    return [{ phaseId: phase.id, label: PHASE_LABELS[phase.type], baselineMinutes: phase.durationMinutes, alternativeMinutes: changed.durationMinutes, deltaMinutes: changed.durationMinutes - phase.durationMinutes }]
  })
  return {
    baseline, alternative, ingredients,
    blendChanged: JSON.stringify(baseline.configuration.flourBlend) !== JSON.stringify(alternative.configuration.flourBlend),
    phaseDurations, phaseChanges,
    uncertainty: [...new Set([...baseline.warnings, ...alternative.warnings])],
  }
}

function validateBlend(value: unknown, issues: PatchIssue[], flours?: Flour[]) {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ field: 'flourBlend', message: 'La miscela deve contenere almeno una farina.' })
    return
  }
  let total = 0
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate) || typeof candidate.flourId !== 'string' || !candidate.flourId.trim() || !isFiniteNumber(candidate.percentage) || candidate.percentage < 0 || candidate.percentage > 100) {
      issues.push({ field: `flourBlend.${index}`, message: 'Seleziona una farina e inserisci una percentuale valida.' })
      continue
    }
    total += candidate.percentage
    const flour = flours?.find(({ id }) => id === candidate.flourId)
    if (flours && !flour) issues.push({ field: `flourBlend.${index}`, message: 'La farina non è presente nel catalogo attuale.' })
    if (flour?.productKind === 'prepared-mix') issues.push({ field: `flourBlend.${index}`, message: 'I preparati con ingredienti aggiunti non sono calcolabili come farina.' })
  }
  if (Math.abs(total - 100) > 1e-6) issues.push({ field: 'flourBlend', message: 'Le percentuali della miscela devono sommare al 100%.' })
}

function validateFermentationPatch(value: unknown, issues: PatchIssue[]) {
  if (!isRecord(value)) {
    issues.push({ field: 'fermentation', message: 'Il piano di fermentazione non è valido.' })
    return
  }
  for (const key of Object.keys(value)) if (!fermentationKeys.has(key)) issues.push({ field: `fermentation.${key}`, message: 'Campo del piano non riconosciuto.' })
  if (value.strategy !== undefined && !strategies.has(value.strategy as FermentationStrategy)) issues.push({ field: 'fermentation.strategy', message: 'La strategia non è valida.' })
  if (value.version !== undefined && value.version !== 1) issues.push({ field: 'fermentation.version', message: 'Versione del piano non supportata.' })
  if (value.timeAnchor !== undefined && value.timeAnchor !== 'start' && value.timeAnchor !== 'bake') issues.push({ field: 'fermentation.timeAnchor', message: 'Punto di ancoraggio non valido.' })
  if (value.yeastMode !== undefined && value.yeastMode !== 'manual' && value.yeastMode !== 'assisted') issues.push({ field: 'fermentation.yeastMode', message: 'Modalità lievito non valida.' })
  if (value.manualYeastUnit !== undefined && value.manualYeastUnit !== 'grams' && value.manualYeastUnit !== 'percentage') issues.push({ field: 'fermentation.manualYeastUnit', message: 'Unità della dose non valida.' })
  if (value.totalDurationMinutes !== undefined && (!isFiniteNumber(value.totalDurationMinutes) || value.totalDurationMinutes <= 0)) issues.push({ field: 'fermentation.totalDurationMinutes', message: 'La durata deve essere positiva.' })
  for (const field of ['ambientTemperatureC', 'refrigeratorTemperatureC', 'measuredDoughTemperatureC', 'targetDoughTemperatureC'] as const) {
    const candidate = value[field]
    const bounds = field === 'refrigeratorTemperatureC' ? [-5, 20] : field === 'ambientTemperatureC' ? [-10, 45] : [-10, 50]
    if (candidate !== undefined && candidate !== null && (!isFiniteNumber(candidate) || candidate < bounds[0] || candidate > bounds[1])) issues.push({ field: `fermentation.${field}`, message: `La temperatura deve essere tra ${bounds[0]} e ${bounds[1]} °C.` })
  }
  if (value.bakingAt !== undefined && (typeof value.bakingAt !== 'string' || !Number.isFinite(Date.parse(value.bakingAt)))) issues.push({ field: 'fermentation.bakingAt', message: 'Inserisci una data e un’ora di cottura valide.' })
  if (value.plannedStartAt !== undefined && (typeof value.plannedStartAt !== 'string' || !Number.isFinite(Date.parse(value.plannedStartAt)))) issues.push({ field: 'fermentation.plannedStartAt', message: 'Inserisci una data e un’ora di inizio valide.' })
  if (value.availability !== undefined) {
    if (!isRecord(value.availability) || (value.availability.avoidRestHours !== undefined && typeof value.availability.avoidRestHours !== 'boolean')) issues.push({ field: 'fermentation.availability', message: 'Le preferenze di disponibilità non sono valide.' })
    else for (const key of ['unavailableStart', 'unavailableEnd'] as const) if (value.availability[key] !== undefined && (typeof value.availability[key] !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.availability[key] as string))) issues.push({ field: `fermentation.availability.${key}`, message: 'Usa un orario nel formato HH:mm.' })
  }
  if (value.phases !== undefined) {
    if (!Array.isArray(value.phases) || !value.phases.every(isFermentationPhase)) issues.push({ field: 'fermentation.phases', message: 'Le fasi contengono valori non validi.' })
    else if (value.totalDurationMinutes !== undefined && value.phases.reduce((total, phase) => total + phase.durationMinutes, 0) !== value.totalDurationMinutes) issues.push({ field: 'fermentation.phases', message: 'La somma delle fasi deve coincidere con la durata totale.' })
  }
  if (value.yeastType !== undefined && !yeastTypes.has(value.yeastType as YeastType)) issues.push({ field: 'fermentation.yeastType', message: 'Il tipo di lievito del piano non è valido.' })
  if (value.planConfirmed !== undefined && typeof value.planConfirmed !== 'boolean') issues.push({ field: 'fermentation.planConfirmed', message: 'Stato del piano non valido.' })
  for (const field of ['estimatorModelId', 'estimatorModelVersion'] as const) if (value[field] !== undefined && typeof value[field] !== 'string') issues.push({ field: `fermentation.${field}`, message: 'Identificativo modello non valido.' })
}

function validateFermentationConfiguration(config: FermentationConfig): PatchIssue[] {
  const issues: PatchIssue[] = []
  validateFermentationPatch(config, issues)
  if (config.version !== 1 || !config.availability || typeof config.availability.avoidRestHours !== 'boolean' || !config.phases.length || config.phases.reduce((sum, phase) => sum + phase.durationMinutes, 0) !== config.totalDurationMinutes) {
    issues.push({ field: 'fermentation.phases', message: 'Il piano deve avere fasi valide la cui durata coincide con il tempo totale.' })
  }
  if (!Number.isFinite(Date.parse(config.bakingAt)) || !Number.isFinite(Date.parse(config.plannedStartAt))) issues.push({ field: 'fermentation.bakingAt', message: 'Le date del piano non sono valide.' })
  if (config.phases.some((phase) => (phase.minimumDurationMinutes !== undefined && phase.durationMinutes < phase.minimumDurationMinutes) || (phase.maximumDurationMinutes !== undefined && phase.durationMinutes > phase.maximumDurationMinutes))) issues.push({ field: 'fermentation.phases', message: 'Una fase non rispetta i limiti di durata configurati.' })
  return issues
}

function isFermentationPhase(value: unknown): value is FermentationPhase {
  return isRecord(value) && typeof value.id === 'string' && phaseTypes.has(value.type as FermentationPhaseType) &&
    isFiniteNumber(value.durationMinutes) && value.durationMinutes >= 0 && environments.has(value.environment as TemperatureEnvironment) &&
    isFiniteNumber(value.temperatureC) && typeof value.notes === 'string' && typeof value.startAt === 'string' && typeof value.endAt === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}