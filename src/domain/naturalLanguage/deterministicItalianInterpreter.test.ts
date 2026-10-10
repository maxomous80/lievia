import { describe, expect, it } from 'vitest'
import { createDefaultDraft } from '../../data/defaults'
import { OFFICIAL_FLOURS } from '../../data/officialFlours'
import { createDefaultFermentationConfig } from '../fermentation/schedule'
import { calculateScenario, createRecipeConfiguration } from '../lab/scenarios'
import { calculateDough } from '../../lib/calculator'
import { toDoughInput } from '../lab/scenarios'
import { createConversation, resetConversation, submitConversationRequest, undoConversationChange } from './conversation'
import { normalizeItalianText, DeterministicItalianInterpreter } from './deterministicItalianInterpreter'
import type { NaturalLanguageContext } from './types'

const interpreter = new DeterministicItalianInterpreter()
const fixedNow = new Date('2026-10-24T10:00:00.000Z')

function makeContext(overrides: Partial<NaturalLanguageContext> = {}): NaturalLanguageContext {
  const fermentation = createDefaultFermentationConfig(fixedNow)
  return {
    currentConfiguration: createRecipeConfiguration({ ...createDefaultDraft('demo-00'), name: 'Impasto di prova', fermentation }, fermentation),
    flours: OFFICIAL_FLOURS,
    pantryEntries: [],
    now: new Date(fixedNow),
    timeZone: 'Europe/Rome',
    ...overrides,
  }
}

describe('interprete italiano deterministico', () => {
  it('normalizza accenti, apostrofi e spazi senza perdere virgole decimali', () => {
    expect(normalizeItalianText('L’idratazione è 70,5%')).toBe('l idratazione e 70,5%')
    expect(normalizeItalianText('Idratazione al -5%')).toBe('idratazione al -5%')
  })

  it('interpreta percentuali con virgola decimale e conserva la ricetta di partenza', () => {
    const context = makeContext()
    const before = structuredClone(context.currentConfiguration)
    const result = interpreter.interpret('Aumenta l’idratazione al 70,5%.', context)
    expect(result.patch.hydrationPct).toBe(70.5)
    expect(result.proposedConfiguration?.hydrationPct).toBe(70.5)
    expect(result.validationErrors).toEqual([])
    expect(context.currentConfiguration).toEqual(before)
  })

  it('estrae stile, numero e peso dei panetti', () => {
    const fourPizzas = interpreter.interpret('Voglio fare quattro pizze contemporanee.', makeContext())
    const sixBalls = interpreter.interpret('Voglio 6 panetti da 250 grammi.', makeContext())
    expect(fourPizzas.patch.style).toBe('contemporanea')
    expect(fourPizzas.patch.ballCount).toBe(4)
    expect(sixBalls.patch.ballCount).toBe(6)
    expect(sixBalls.patch.ballWeight).toBe(250)
    expect(interpreter.interpret('Impasto totale 1,2 kg.', makeContext()).patch.useTotalWeight).toBe(true)
    expect(interpreter.interpret('Impasto totale 1,2 kg.', makeContext()).patch.totalDoughWeight).toBe(1200)
    expect(interpreter.interpret('6 panetti e impasto totale 1 kg.', makeContext()).ambiguities[0].field).toBe('doughWeight')
  })

  it('distingue la massa assoluta del lievito dalla percentuale sulla farina', () => {
    const context = makeContext()
    const result = interpreter.interpret('Metti due grammi di lievito fresco.', context)
    const flourWeight = calculateDough(toDoughInput(context.currentConfiguration)).flourWeight
    expect(result.patch.yeastType).toBe('fresh')
    expect(result.patch.yeastPct).toBeCloseTo(2 / flourWeight * 100, 8)
    expect(result.validationErrors).toEqual([])
  })

  it('risolve domani e un orario italiano in Europe/Rome senza dipendere dal fuso del processo', () => {
    const result = interpreter.interpret('Sposta la cottura a domani alle 20:30.', makeContext())
    expect(result.patch.fermentation?.bakingAt).toBe('2026-10-25T19:30:00.000Z')
  })

  it('risolve dopodomani e il giorno della settimana con un orologio iniettato', () => {
    const context = makeContext({ now: new Date('2026-10-24T10:00:00.000Z') })
    expect(interpreter.interpret('Cuoci dopodomani alle 21.', context).patch.fermentation?.bakingAt).toBe('2026-10-26T20:00:00.000Z')
    expect(interpreter.interpret('Sposta la cottura a domenica alle 21.', context).patch.fermentation?.bakingAt).toBe('2026-10-25T20:00:00.000Z')
  })

  it('chiede chiarimenti per gli orari inesistenti o ripetuti nei cambi stagionali', () => {
    const context = makeContext({ now: new Date('2026-03-28T12:00:00.000Z') })
    const missingHour = interpreter.interpret('Sposta la cottura al 29/03/2026 alle 2:30.', context)
    expect(missingHour.ambiguities[0].question).toMatch(/non esiste/)
    const repeatedHour = interpreter.interpret('Sposta la cottura al 25/10/2026 alle 2:30.', context)
    expect(repeatedHour.ambiguities[0].question).toMatch(/si ripete/)
  })

  it('interpreta più parametri, durata e temperatura usando le API di pianificazione', () => {
    const result = interpreter.interpret('Prova una lievitazione di 48 ore in frigorifero a 5 gradi.', makeContext())
    expect(result.patch.fermentation?.totalDurationMinutes).toBe(2880)
    expect(result.patch.fermentation?.refrigeratorTemperatureC).toBe(5)
    expect(result.patch.fermentation?.strategy).toBe('refrigerated')
    expect(result.proposedConfiguration?.fermentation.phases.reduce((sum, phase) => sum + phase.durationMinutes, 0)).toBe(2880)
  })

  it('mostra come non fattibile la proposta combinata di un’ora senza alterare il lievito', () => {
    const context = makeContext()
    const interpreted = interpreter.interpret('Fai una fermentazione combinata di 1 ora.', context)
    expect(interpreted.validationErrors).toEqual([])
    expect(interpreted.proposedConfiguration?.fermentation.totalDurationMinutes).toBe(60)
    expect(interpreted.proposedConfiguration?.yeastPct).toBe(context.currentConfiguration.yeastPct)
    const preview = calculateScenario('one-hour', 'Un’ora', interpreted.proposedConfiguration!, OFFICIAL_FLOURS, [])
    expect(preview.schedule.validation.status).toBe('Piano non fattibile')
  })

  it('risolve una farina per marca e prodotto dal catalogo esistente', () => {
    const flour = OFFICIAL_FLOURS.find((item) => /caputo/i.test(item.brand) && /nuvola/i.test(item.name))
    if (!flour) return
    const result = interpreter.interpret(`Usa il 30% di ${flour.brand} ${flour.name}.`, makeContext())
    expect(result.ambiguities).toEqual([])
    expect(result.patch.flourBlend?.find(({ flourId }) => flourId === flour.id)?.percentage).toBe(30)
  })

  it('chiede scelta per un marchio ambiguo e non inventa farine', () => {
    const context = makeContext()
    const ambiguous = interpreter.interpret('Usa Caputo.', context)
    expect(ambiguous.ambiguities.some(({ choices }) => (choices?.length ?? 0) > 1)).toBe(true)
    expect(interpreter.interpret('Usa il 30% di Caputo.', context).ambiguities.find(({ field }) => field === 'flourBlend')?.choicePercentage).toBe(30)
    const missing = interpreter.interpret('Usa il 30% di Molino Che Non Esiste.', context)
    expect(missing.unsupportedRequests).toHaveLength(1)
    expect(missing.proposedConfiguration).toBeNull()
  })

  it('non sostituisce automaticamente farine assenti dalla dispensa', () => {
    const result = interpreter.interpret('Usa le farine che ho in dispensa.', makeContext())
    expect(result.usePantryOnly).toBe(true)
    expect(result.ambiguities.some(({ field }) => field === 'flourBlend')).toBe(true)
    expect(result.patch.flourBlend).toBeUndefined()
  })

  it('mantiene il vincolo dispensa tra turni e lo rimuove solo su richiesta esplicita', () => {
    const context = makeContext()
    const baseline = context.currentConfiguration.flourBlend[0].flourId
    const available = OFFICIAL_FLOURS.find(({ id }) => id !== baseline && !/prepared-mix/.test(id))
    if (!available) return
    const pantryEntries = [{ flourId: available.id, quantityGrams: 1000, notes: '', updatedAt: fixedNow.toISOString() }]
    const constrained = interpreter.interpret('Usa solo le farine che ho in dispensa.', makeContext({ pantryEntries }))
    expect(constrained.usePantryOnly).toBe(true)
    const followUp = interpreter.interpret(`Usa ${available.brand} ${available.name}.`, makeContext({ pantryEntries, pantryOnly: true }))
    expect(followUp.ambiguities).toEqual([])
    expect(followUp.patch.flourBlend?.some(({ flourId }) => flourId === available.id)).toBe(true)
    const released = interpreter.interpret('Senza vincolo dispensa, usa una farina del catalogo.', makeContext({ pantryOnly: true }))
    expect(released.usePantryOnly).toBe(false)
  })

  it('completa una miscela dalla dispensa solo quando la scelta residua è unica', () => {
    const named = OFFICIAL_FLOURS.find(({ brand, name, productKind }) => /caputo/i.test(brand) && /nuvola/i.test(name) && productKind !== 'prepared-mix')
    const pantryFlours = OFFICIAL_FLOURS.filter(({ id, productKind }) => id !== named?.id && productKind !== 'prepared-mix').slice(0, 2)
    if (!named || pantryFlours.length < 2) return
    const pantryEntries = [named, ...pantryFlours].map(({ id }) => ({ flourId: id, quantityGrams: 1000, notes: '', updatedAt: fixedNow.toISOString() }))
    const prompt = `Usa il 30% di ${named.brand} ${named.name} e completa con la farina che ho in dispensa.`
    const unique = interpreter.interpret(prompt, makeContext({ pantryEntries: pantryEntries.slice(0, 2) }))
    expect(unique.ambiguities).toEqual([])
    expect(unique.patch.flourBlend?.map(({ flourId, percentage }) => ({ flourId, percentage }))).toContainEqual({ flourId: pantryFlours[0].id, percentage: 70 })
    const ambiguous = interpreter.interpret(prompt, makeContext({ pantryEntries }))
    expect(ambiguous.ambiguities.find(({ choicePercentage }) => choicePercentage !== undefined)?.choicePercentage).toBe(70)
    expect(ambiguous.ambiguities.flatMap(({ choices }) => choices ?? []).map(({ id }) => id)).toContain(pantryFlours[1].id)
  })

  it('in un prompt combinato conserva ogni richiesta esplicita senza dedurre dati assenti', () => {
    const result = interpreter.interpret('Voglio 6 panetti da 250 grammi al 70,5% di idratazione, 48 ore in frigorifero a 5 gradi e cottura domani alle 20:30.', makeContext())
    expect(result.patch.ballCount).toBe(6)
    expect(result.patch.ballWeight).toBe(250)
    expect(result.patch.hydrationPct).toBe(70.5)
    expect(result.patch.fermentation?.totalDurationMinutes).toBe(2880)
    expect(result.patch.fermentation?.strategy).toBe('refrigerated')
    expect(result.patch.fermentation?.refrigeratorTemperatureC).toBe(5)
    expect(result.patch.fermentation?.bakingAt).toBe('2026-10-25T19:30:00.000Z')
    expect(result.ambiguities).toEqual([])
    expect(result.validationErrors).toEqual([])
    expect(result.proposedConfiguration?.saltPct).toBe(makeContext().currentConfiguration.saltPct)
  })

  it('segnala richieste contraddittorie e valori impossibili', () => {
    const contradiction = interpreter.interpret('Idratazione al 65% e idratazione al 75%.', makeContext())
    expect(contradiction.ambiguities.some(({ field }) => field === 'hydrationPct')).toBe(true)
    const impossible = interpreter.interpret('Idratazione al 400%.', makeContext())
    expect(impossible.validationErrors.some(({ field }) => field === 'hydrationPct')).toBe(true)
    expect(impossible.proposedConfiguration).toBeNull()
    expect(interpreter.interpret('Idratazione al -5%.', makeContext()).validationErrors).not.toEqual([])
  })

  it('supporta modifiche parziali senza cambiare i valori non citati', () => {
    const context = makeContext()
    const result = interpreter.interpret('Aumenta l’idratazione al 70%.', context)
    expect(result.proposedConfiguration?.saltPct).toBe(context.currentConfiguration.saltPct)
    expect(result.proposedConfiguration?.ballWeight).toBe(context.currentConfiguration.ballWeight)
  })

  it('riconosce indisponibilità e richieste approssimative senza applicarle di nascosto', () => {
    const availability = interpreter.interpret('Non posso fare lo staglio tra le 23 e le 8.', makeContext())
    expect(availability.patch.fermentation?.availability).toEqual({ avoidRestHours: true, unavailableStart: '23:00', unavailableEnd: '08:00' })
    const approximate = interpreter.interpret('Idratazione circa 70%.', makeContext())
    expect(approximate.ambiguities.some(({ field }) => field === 'value')).toBe(true)
    expect(approximate.patch.hydrationPct).toBeUndefined()
  })

  it('non dichiara comprensione per richieste fuori ambito', () => {
    const result = interpreter.interpret('Dimmi se la pizza sarà soffice e profumata.', makeContext())
    expect(result.intent).toBe('unsupported')
    expect(result.unsupportedRequests[0].suggestion).toContain('idratazione')
    expect(result.proposedConfiguration).toBeNull()
  })

  it('mantiene le proposte isolate, permette annullamento e reset senza persistenza', () => {
    const context = makeContext()
    const conversation = createConversation(context.currentConfiguration)
    const changed = submitConversationRequest(conversation, 'Aumenta l’idratazione al 70%.', interpreter, {
      flours: context.flours, pantryEntries: context.pantryEntries, now: context.now, timeZone: context.timeZone,
    })
    expect(changed.configuration.hydrationPct).toBe(70)
    expect(changed.baseline.hydrationPct).toBe(context.currentConfiguration.hydrationPct)
    expect(undoConversationChange(changed).configuration.hydrationPct).toBe(context.currentConfiguration.hydrationPct)
    expect(resetConversation(changed).messages).toEqual([])
    const unsupported = submitConversationRequest(conversation, 'Prevedi il gusto della pizza.', interpreter, {
      flours: context.flours, pantryEntries: context.pantryEntries, now: context.now, timeZone: context.timeZone,
    })
    expect(unsupported.configuration).toEqual(conversation.configuration)
  })
})