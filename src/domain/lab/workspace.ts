import type { Flour } from '../../models'
import {
  cloneRecipeConfiguration,
  normalizeRecipeConfiguration,
  validateRecipePatch,
  type RecipeConfiguration,
  type PatchIssue,
} from './scenarios'

export interface LabScenario {
  id: string
  name: string
  configuration: RecipeConfiguration
  createdAt: string
  updatedAt: string
}

export interface LabSession {
  id: string
  baselineId: string
  baselineName: string
  baselineConfiguration: RecipeConfiguration
  sourceRecipeId?: string
  scenarios: LabScenario[]
  selectedScenarioId: string
  createdAt: string
  updatedAt: string
}

export interface LabWorkspace {
  version: 1
  activeSessionId: string | null
  sessions: LabSession[]
}

export const EMPTY_LAB_WORKSPACE: LabWorkspace = { version: 1, activeSessionId: null, sessions: [] }

export function createLabSession(input: {
  id: string
  baselineId: string
  baselineName: string
  baselineConfiguration: RecipeConfiguration
  sourceRecipeId?: string
  scenarioId: string
  now: string
}): LabSession {
  const baselineConfiguration = cloneRecipeConfiguration(input.baselineConfiguration)
  const scenario: LabScenario = {
    id: input.scenarioId,
    name: 'Scenario 1',
    configuration: cloneRecipeConfiguration(baselineConfiguration),
    createdAt: input.now,
    updatedAt: input.now,
  }
  return {
    id: input.id,
    baselineId: input.baselineId,
    baselineName: input.baselineName,
    baselineConfiguration,
    sourceRecipeId: input.sourceRecipeId,
    scenarios: [scenario],
    selectedScenarioId: scenario.id,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function createAlternativeScenario(session: LabSession, id: string, now: string, sourceScenarioId?: string): LabSession {
  const source = session.scenarios.find(({ id: scenarioId }) => scenarioId === sourceScenarioId)
  const configuration = source ? source.configuration : session.baselineConfiguration
  const scenario: LabScenario = {
    id,
    name: `Scenario ${session.scenarios.length + 1}`,
    configuration: cloneRecipeConfiguration(configuration),
    createdAt: now,
    updatedAt: now,
  }
  return { ...session, scenarios: [...session.scenarios, scenario], selectedScenarioId: id, updatedAt: now }
}

export function renameScenario(session: LabSession, scenarioId: string, name: string, now: string): LabSession {
  if (!name.trim()) return session
  return {
    ...session,
    scenarios: session.scenarios.map((scenario) => scenario.id === scenarioId
      ? { ...scenario, name: name.trim(), updatedAt: now }
      : scenario),
    updatedAt: now,
  }
}

export function resetScenario(session: LabSession, scenarioId: string, now: string): LabSession {
  return {
    ...session,
    scenarios: session.scenarios.map((scenario) => scenario.id === scenarioId
      ? { ...scenario, configuration: cloneRecipeConfiguration(session.baselineConfiguration), updatedAt: now }
      : scenario),
    updatedAt: now,
  }
}

export function selectScenario(session: LabSession, scenarioId: string, now: string): LabSession {
  if (!session.scenarios.some(({ id }) => id === scenarioId)) return session
  return { ...session, selectedScenarioId: scenarioId, updatedAt: now }
}

export function patchScenario(session: LabSession, scenarioId: string, patch: unknown, flours: Flour[], now: string): { session: LabSession; issues: PatchIssue[] } {
  let issues: PatchIssue[] = []
  const scenarios = session.scenarios.map((scenario) => {
    if (scenario.id !== scenarioId) return scenario
    const result = validateRecipePatch(scenario.configuration, patch, flours)
    if (!result.ok) {
      issues = result.issues
      return scenario
    }
    return { ...scenario, configuration: result.configuration, updatedAt: now }
  })
  return { session: issues.length ? session : { ...session, scenarios, updatedAt: now }, issues }
}

export function prepareScenarioApplication(session: LabSession, scenarioId: string, confirmed: boolean): RecipeConfiguration | null {
  if (!confirmed) return null
  const scenario = session.scenarios.find(({ id }) => id === scenarioId)
  return scenario ? cloneRecipeConfiguration(scenario.configuration) : null
}

export function removeScenario(session: LabSession, scenarioId: string, now: string): LabSession {
  const scenarios = session.scenarios.filter(({ id }) => id !== scenarioId)
  if (scenarios.length === session.scenarios.length) return session
  return { ...session, scenarios, selectedScenarioId: session.selectedScenarioId === scenarioId ? scenarios[0]?.id ?? '' : session.selectedScenarioId, updatedAt: now }
}

export function upsertLabSession(workspace: LabWorkspace, session: LabSession): LabWorkspace {
  const sessions = [...workspace.sessions.filter(({ id }) => id !== session.id), session]
  return { version: 1, activeSessionId: session.id, sessions }
}

export function normalizeLabWorkspace(value: unknown): LabWorkspace {
  if (value === null || value === undefined) return EMPTY_LAB_WORKSPACE
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sessions)) {
    throw new TypeError('L’archivio Lievia Lab è incompleto o non riconosciuto. Non è stato sovrascritto; esporta o recupera una copia valida.')
  }
  const sessions = value.sessions.map((candidate) => {
    const session = normalizeSession(candidate)
    if (!session) throw new TypeError('Una sessione o uno scenario Lievia Lab non è valido. Nessuno scenario è stato scartato.')
    return session
  })
  if (new Set(sessions.map(({ id }) => id)).size !== sessions.length) throw new TypeError('L’archivio Lievia Lab contiene ID di sessione duplicati.')
  const requestedActive = typeof value.activeSessionId === 'string' ? value.activeSessionId : null
  return {
    version: 1,
    activeSessionId: sessions.some(({ id }) => id === requestedActive) ? requestedActive : sessions.at(-1)?.id ?? null,
    sessions,
  }
}

function normalizeSession(value: unknown): LabSession | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.baselineId !== 'string' ||
    typeof value.baselineName !== 'string' || !Array.isArray(value.scenarios) || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return null
  const baselineConfiguration = normalizeRecipeConfiguration(value.baselineConfiguration)
  if (!baselineConfiguration) return null
  const scenarios = value.scenarios.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !candidate.id || typeof candidate.name !== 'string' ||
      !isValidDate(candidate.createdAt) || !isValidDate(candidate.updatedAt)) return null
    const configuration = normalizeRecipeConfiguration(candidate.configuration)
    return configuration ? { id: candidate.id, name: candidate.name, configuration, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt } : null
  })
  if (!scenarios.length || scenarios.some((scenario) => scenario === null)) return null
  const validScenarios = scenarios as LabScenario[]
  if (new Set(validScenarios.map(({ id }) => id)).size !== validScenarios.length) return null
  const selectedScenarioId = typeof value.selectedScenarioId === 'string' && validScenarios.some(({ id }) => id === value.selectedScenarioId)
    ? value.selectedScenarioId
    : validScenarios[0].id
  return {
    id: value.id,
    baselineId: value.baselineId,
    baselineName: value.baselineName,
    baselineConfiguration,
    sourceRecipeId: typeof value.sourceRecipeId === 'string' ? value.sourceRecipeId : undefined,
    scenarios: validScenarios,
    selectedScenarioId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}