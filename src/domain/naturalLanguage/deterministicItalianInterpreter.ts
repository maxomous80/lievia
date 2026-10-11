import type { Flour, FlourBlendItem, PizzaStyle, YeastType } from '../../models'
import { calculateDough } from '../../lib/calculator'
import { isFlourBlendEligible } from '../flours/blendProperties'
import { applyStrategyTemplate } from '../fermentation/schedule'
import type { FermentationStrategy } from '../fermentation/types'
import { toDoughInput, validateRecipePatch, type FermentationPatch, type RecipeConfiguration, type RecipePatch } from '../lab/scenarios'
import type { NaturalLanguageAmbiguity, NaturalLanguageContext, NaturalLanguageEntity, NaturalLanguageInterpretation, NaturalLanguageInterpreter, UnsupportedRequest } from './types'

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6,
  sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, tredici: 13,
  quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18,
  diciannove: 19, venti: 20, ventuno: 21, ventidue: 22, ventiquattro: 24,
  trenta: 30, quarantotto: 48, cento: 100,
}

const NUMBER_TOKEN = '(?:-?\\d+(?:[.,]\\d+)?|quarantotto|ventidue|ventiquattro|ventuno|diciassette|diciotto|diciannove|quattordici|quindici|sedici|tredici|undici|dodici|dieci|cinque|quattro|sette|otto|nove|zero|una|uno|un|due|tre|sei|venti|trenta|cento)'
const STYLE_ALIASES: Array<{ style: PizzaStyle; expression: RegExp }> = [
  { style: 'napoletana', expression: /\bnapoletan[aeo]s?\b/ },
  { style: 'contemporanea', expression: /\bcontemporane[aeo]s?\b/ },
  { style: 'romana', expression: /\broman[aeo]s?\b/ },
  { style: 'teglia', expression: /\b(?:in\s+)?teglia\b/ },
  { style: 'padellino', expression: /\bpadellino\b/ },
  { style: 'focaccia', expression: /\bfocacci[ae]\b/ },
]
const WEEKDAYS = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato']
const GENERIC_FLOUR_WORDS = new Set(['farina', 'farine', 'usa', 'utilizza', 'scegli', 'metti', 'miscela', 'con', 'di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'il', 'lo', 'la', 'i', 'gli', 'le', 'e', 'solo', 'percento', 'percentuale', 'idratazione', 'acqua', 'sale', 'olio', 'lievito', 'impasto'])

export class DeterministicItalianInterpreter implements NaturalLanguageInterpreter {
  interpret(text: string, context: NaturalLanguageContext): NaturalLanguageInterpretation {
    const normalizedText = normalizeItalianText(text)
    const patch: RecipePatch = {}
    const entities: NaturalLanguageEntity[] = []
    const ambiguities: NaturalLanguageAmbiguity[] = []
    const validationErrors: NaturalLanguageInterpretation['validationErrors'] = []
    const unsupportedRequests: UnsupportedRequest[] = []
    const proposals = new Map<string, Array<{ value: unknown; sourceText: string }>>()
    let usePantryOnly: boolean | null = null
    const completeFromPantry = /\bcompleta\s+(?:con\s+)?(?:la\s+)?farin(?:a|e)\s+(?:che\s+)?ho\s+(?:in\s+)?dispensa\b/.test(normalizedText)
    let recognized = false
    let proposedConfiguration: RecipeConfiguration | null = null

    const propose = (field: string, value: unknown, sourceText: string) => {
      recognized = true
      const list = proposals.get(field) ?? []
      list.push({ value, sourceText })
      proposals.set(field, list)
    }

    for (const { style, expression } of STYLE_ALIASES) {
      if (expression.test(normalizedText)) propose('style', style, text)
    }
    for (const match of normalizedText.matchAll(new RegExp(`\\b(${NUMBER_TOKEN})\\s*(?:pizze|panetti?|palline?|pezzi)\\b`, 'g'))) {
      const value = numberValue(match[1])
      if (value !== undefined) propose('ballCount', value, match[0])
    }
    const countCorrection = normalizedText.match(new RegExp(`\\b(?:ma anche|oppure)\\s+(${NUMBER_TOKEN})\\b`))
    if (countCorrection && /\b(?:pizze|panetti?|palline?)\b/.test(normalizedText.slice(0, countCorrection.index))) {
      const value = numberValue(countCorrection[1])
      if (value !== undefined) propose('ballCount', value, countCorrection[0])
    }

    for (const match of normalizedText.matchAll(new RegExp(`\\b(?:panetti?|palline?|pizze?)\\s*(?:da|di)\\s*(${NUMBER_TOKEN})\\s*(?:(?:g|gr|grammi?|grammos?)\\b)?(?:\\s+ciascun[oaie])?|\\b(${NUMBER_TOKEN})\\s*(?:g|gr|grammi?|grammos?)\\s*(?:per|a)\\s*(?:panetto|pallina)\\b`, 'g'))) {
      const value = numberValue(match[1] ?? match[2])
      if (value !== undefined) propose('ballWeight', value, match[0])
    }
    for (const match of normalizedText.matchAll(new RegExp(`\\b(${NUMBER_TOKEN})\\s*(?:g|gr|grammi?|grammos?)\\s+ciascun[oaie]\\b`, 'g'))) {
      const value = numberValue(match[1])
      if (value !== undefined && /\b(?:panetti?|palline?|pizze?)\b/.test(normalizedText)) propose('ballWeight', value, match[0])
    }

    for (const match of normalizedText.matchAll(new RegExp(`\\b(?:peso|massa|impasto)\\s+(?:(?:totale|complessiv[oa])\\s+)?(?:da|di)?\\s*(${NUMBER_TOKEN})\\s*(kg|g|grammi?)\\b`, 'g'))) {
      const value = numberValue(match[1])
      if (value !== undefined) propose('totalDoughWeight', value * (match[2] === 'kg' ? 1000 : 1), match[0])
    }
    for (const match of normalizedText.matchAll(new RegExp(`\\b(${NUMBER_TOKEN})\\s*(kg|g|grammi?)\\s+(?:di\\s+)?impasto\\s+(?:totale|complessiv[oa])\\b`, 'g'))) {
      const value = numberValue(match[1])
      if (value !== undefined) propose('totalDoughWeight', value * (match[2] === 'kg' ? 1000 : 1), match[0])
    }
    for (const match of normalizedText.matchAll(new RegExp(`\\b(${NUMBER_TOKEN})\\s*(kg|g|grammi?)\\s+(?:di\\s+)?(?:impasto\\s+)?(?:totale|complessiv[oa])\\b`, 'g'))) {
      const value = numberValue(match[1])
      if (value !== undefined) propose('totalDoughWeight', value * (match[2] === 'kg' ? 1000 : 1), match[0])
    }
    if (/\b(?:un|uno) chilo e mezzo\b/.test(normalizedText) && /\b(?:impasto|massa)\b/.test(normalizedText)) {
      propose('totalDoughWeight', 1500, normalizedText.match(/(?:un|uno) chilo e mezzo[^,.!?;]*/)?.[0] ?? text)
    }

    collectPercentage(normalizedText, /(?:idratazione|acqua)\s+(?:al|all|a|di)?\s*(?:circa\s*)?(__NUMBER__)\s*%?/g, (value, source) => propose('hydrationPct', value, source))
    collectPercentage(normalizedText, /impasto\s+(?:al|all|a)\s*(__NUMBER__)\s*%/g, (value, source) => propose('hydrationPct', value, source))
    collectPercentage(normalizedText, /(__NUMBER__)\s*%\s*(?:di\s+)?(?:idratazione|acqua)/g, (value, source) => propose('hydrationPct', value, source))
    collectPercentage(normalizedText, /(?:fai|porta|metti)\s+(__NUMBER__)\s*%/g, (value, source) => {
      if (/\b(?:acqua|idratazione)\b/.test(normalizedText)) propose('hydrationPct', value, source)
    })
    collectPercentage(normalizedText, /(?:sale|salatura)\s+(?:al|all|a|di)?\s*(__NUMBER__)\s*%?/g, (value, source) => propose('saltPct', value, source))
    collectPercentage(normalizedText, /(__NUMBER__)\s*%\s*(?:di\s+)?(?:sale|salatura)/g, (value, source) => propose('saltPct', value, source))
    collectPercentage(normalizedText, /(?:olio|olio evo)\s+(?:al|all|a|di)?\s*(__NUMBER__)\s*%?/g, (value, source) => propose('oilPct', value, source))
    collectPercentage(normalizedText, /(__NUMBER__)\s*%\s*(?:di\s+)?olio(?:\s+evo)?/g, (value, source) => propose('oilPct', value, source))
    collectPercentage(normalizedText, /(?:olio|olio evo)[,;]?\s+tipo\s+(__NUMBER__)\s*%/g, (value, source) => propose('oilPct', value, source))
    const continuedPercentage = new RegExp(`\\b(?:poi|anzi|ma anche|oppure)\\s+(?:(?:al|a|il|lo)\\s+)?(${NUMBER_TOKEN})\\s*%?\\b`, 'g')
    for (const match of normalizedText.matchAll(continuedPercentage)) {
      const preceding = normalizedText.slice(0, match.index)
      const previousField = [...preceding.matchAll(/\b(idratazione|acqua|sale|salatura|olio)\b/g)].at(-1)?.[1]
      const field = previousField === 'idratazione' || previousField === 'acqua' ? 'hydrationPct'
        : previousField === 'sale' || previousField === 'salatura' ? 'saltPct'
          : previousField === 'olio' ? 'oilPct' : undefined
      const value = numberValue(match[1])
      if (field && value !== undefined) propose(field, value, match[0])
    }

    const yeastType = parseYeastType(normalizedText)
    if (yeastType) propose('yeastType', yeastType.value, yeastType.source)
    const flourWeight = calculateFlourWeight(context.currentConfiguration)
    const yeastMassPattern = new RegExp(`\\b(${NUMBER_TOKEN})\\s*(?:g|gr|grammi?|grammos?)\\s*(?:di\\s+)?lievito\\b`, 'g')
    for (const match of normalizedText.matchAll(yeastMassPattern)) {
      const grams = numberValue(match[1])
      if (grams === undefined) continue
      if (flourWeight === null || flourWeight <= 0) {
        validationErrors.push({ field: 'yeastPct', message: 'Non riesco a ricavare la farina totale per convertire i grammi di lievito.' })
        continue
      }
      propose('yeastPct', grams / flourWeight * 100, match[0])
    }
    collectPercentage(normalizedText, /(?:lievito\s+(?:al|a|di)?\s*|__NUMBER__\s*(?:%|per\s+cento)\s*(?:di\s+)?lievito)/g, (value, source) => propose('yeastPct', value, source))

    collectTemperature(normalizedText, /(?:temperatura\s+ambiente|ambiente(?:\s+(?:a|di))?|in\s+cucina(?:\s+a)?)\s*(?:di|a|:)?\s*__NUMBER__\s*(?:°\s*c|gradi(?:\s*celsius)?|celsius)?/g, (value, source) => propose('fermentation.ambientTemperatureC', value, source))
    collectTemperature(normalizedText, /(?:temperatura\s+(?:del\s+)?(?:frigo|frigorifero)|frigo(?:rifero)?(?:\s+(?:a|di))?)\s*(?:di|a|:)?\s*__NUMBER__\s*(?:°\s*c|gradi(?:\s*celsius)?|celsius)?/g, (value, source) => propose('fermentation.refrigeratorTemperatureC', value, source))
    collectTemperature(normalizedText, /(?:temperatura\s+(?:dell?\s+)?impasto|impasto\s+misurato)\s*(?:di|a|:)?\s*__NUMBER__\s*(?:°\s*c|gradi(?:\s*celsius)?|celsius)?/g, (value, source) => propose('fermentation.measuredDoughTemperatureC', value, source))

    collectTemperature(normalizedText, /(?:tieni|mantieni|porta)\s+(?:l\s+)?impasto\s+(?:a|di)\s*__NUMBER__\s*(?:°\s*c|gradi(?:\s+celsius)?|celsius)/g, (value, source) => propose('fermentation.ambientTemperatureC', value, source))
    collectTemperature(normalizedText, /temperatura\s+misurata\s+(?:dell?\s+)?impasto\s+(?:e\s+)?__NUMBER__\s*(?:°\s*c|gradi(?:\s+celsius)?|celsius)/g, (value, source) => propose('fermentation.measuredDoughTemperatureC', value, source))
    const measuredDoughTemperaturePattern = new RegExp(`temperatura\\s+misurata\\s+dell?\\s+impasto\\s+e\\s+(${NUMBER_TOKEN})\\s*(?:°\\s*c)?`, 'g')
    for (const match of normalizedText.matchAll(measuredDoughTemperaturePattern)) {
      const value = numberValue(match[1])
      if (value !== undefined) propose('fermentation.measuredDoughTemperatureC', value, match[0])
    }
    collectTemperature(normalizedText, /temperatura\s+dell?\s+impasto\s+misurata\s+(?:e\s+)?__NUMBER__\s*(?:°\s*c|gradi(?:\s+celsius)?|celsius)/g, (value, source) => propose('fermentation.measuredDoughTemperatureC', value, source))
    for (const match of normalizedText.matchAll(new RegExp(`(?:(?:lievitazione|fermentazione)(?:\\s+(?:di|da))?\\s+)?(${NUMBER_TOKEN})\\s*(ore|ora|giorni|giorno|minuti?|min)\\b`, 'g'))) {
      if (/\b(?:tra|fra)\s+$/.test(normalizedText.slice(0, match.index))) continue
      const value = numberValue(match[1])
      if (value !== undefined) propose('fermentation.totalDurationMinutes', value * (match[2].startsWith('giorn') ? 1440 : match[2].startsWith('or') ? 60 : 1), match[0])
    }
    if (/\b(?:un|uno) giorno e mezzo\b/.test(normalizedText)) {
      proposals.delete('fermentation.totalDurationMinutes')
      ambiguities.push({ field: 'fermentation.totalDurationMinutes', question: 'Con “un giorno e mezzo” intendi 36 ore? Conferma la durata prima di aggiornare il piano.' })
    }

    for (const strategy of parseStrategies(normalizedText)) propose('fermentation.strategy', strategy.value, strategy.source)

    const availability = parseAvailability(normalizedText, context.currentConfiguration.fermentation.availability)
    if (availability) propose('fermentation.availability', availability.value, availability.source)

    if (/\b(?:con\s+)?(?:(?:le|la)\s+)?farin(?:a|e)\s+(?:che\s+)?ho\s+(?:in\s+)?dispensa\b|\bsolo\s+(?:(?:le|la)\s+)?farin(?:a|e)\s+(?:della\s+)?dispensa\b|\bsolo\s+farine\s+(?:disponibili|presenti)\b/.test(normalizedText)) {
      usePantryOnly = true
      recognized = true
      entities.push({ field: 'usePantryOnly', value: true, sourceText: text, certainty: 'explicit' })
    } else if (/\b(?:senza\s+vincolo\s+dispensa|non\s+limitare\s+alla\s+dispensa|tutte\s+le\s+farine\s+del\s+catalogo)\b/.test(normalizedText)) {
      usePantryOnly = false
      recognized = true
      entities.push({ field: 'usePantryOnly', value: false, sourceText: text, certainty: 'explicit' })
    }
    const pantryConstraintActive = usePantryOnly ?? context.pantryOnly === true

    const genericFlourRequest = /\b(?:farina forte|farina blu|farina qualsiasi|scegli tu una farina|completa la miscela|solo farine presenti in dispensa|solo farine della dispensa)\b/.test(normalizedText)
    const flourRequests = genericFlourRequest ? [] : parseFlourMentions(normalizedText)
    const resolvedFlours = flourRequests.map((request) => resolveFlour(request.name, context.flours))
    for (let index = 0; index < flourRequests.length; index += 1) {
      const request = flourRequests[index]
      const resolution = resolvedFlours[index]
      recognized = true
      if (resolution.length !== 1) {
        ambiguities.push({
          field: 'flourBlend',
          question: resolution.length ? `Quale farina intendi con “${request.name.trim()}”?` : `Non trovo “${request.name.trim()}” nel catalogo. Scegli una farina esistente o riformula con marca e prodotto.`,
          choices: resolution.map((flour) => ({ id: flour.id, label: `${flour.brand} · ${flour.name}` })),
          choicePercentage: request.percentage,
        })
        continue
      }
      const flour = resolution[0]
      if (!isFlourBlendEligible(flour)) {
        validationErrors.push({ field: 'flourBlend', message: `${flour.brand} · ${flour.name} è un preparato, non una farina selezionabile nella miscela.` })
        continue
      }
      if (pantryConstraintActive && !context.pantryEntries.some(({ flourId }) => flourId === flour.id)) {
        ambiguities.push({ field: 'flourBlend', question: `${flour.brand} · ${flour.name} non è in dispensa. Vuoi scegliere una farina presente?`, choices: context.pantryEntries.flatMap(({ flourId }) => { const candidate = context.flours.find(({ id }) => id === flourId); return candidate && isFlourBlendEligible(candidate) ? [{ id: candidate.id, label: `${candidate.brand} · ${candidate.name}` }] : [] }) })
        continue
      }
      propose('flourBlend.request', { flourId: flour.id, percentage: request.percentage }, request.source)
    }
    if (genericFlourRequest && !ambiguities.some(({ field }) => field === 'flourBlend')) {
      ambiguities.push({ field: 'flourBlend', question: 'Quale farina del catalogo vuoi usare? Indica marca e prodotto, oppure scegli una delle farine disponibili.' })
      recognized = true
      if (/\bfarina blu\b/.test(normalizedText)) {
        unsupportedRequests.push({ text, explanation: '“Farina blu” non identifica un prodotto verificabile nel catalogo.', suggestion: 'Scegli una farina dal catalogo o indica marca e nome del prodotto.' })
      }
    }

    const dateTime = parseBakingDateTime(normalizedText, context)
    if (dateTime.error) ambiguities.push({ field: 'fermentation.bakingAt', question: dateTime.error })
    if (dateTime.value) propose('fermentation.bakingAt', dateTime.value, dateTime.source)

    const approximate = /\b(?:circa|all incirca|piu o meno|intorno a|approssimativamente)\b/.test(normalizedText)
    if (approximate && proposals.size) {
      ambiguities.push({ field: 'value', question: 'Hai indicato un valore approssimativo. Quale valore preciso vuoi impostare?' })
      proposals.clear()
    }

    const conflictingFields: string[] = []
    for (const [field, values] of proposals) {
      if (field === 'flourBlend.request') continue
      const distinct = new Map(values.map((item) => [JSON.stringify(item.value), item]))
      if (distinct.size > 1) {
        conflictingFields.push(field)
        ambiguities.push({ field, question: `Hai indicato valori diversi per ${fieldLabel(field)}. Quale devo usare?` })
        continue
      }
      const selected = values.at(-1)!
      assignPatch(patch, field, selected.value)
      entities.push({ field, value: entityValue(selected.value), sourceText: selected.sourceText, certainty: 'explicit' })
    }

    if (patch.totalDoughWeight !== undefined && (patch.ballCount !== undefined || patch.ballWeight !== undefined)) {
      ambiguities.push({ field: 'doughWeight', question: 'Hai indicato sia il peso totale sia il numero o il peso dei panetti. Quale modalità vuoi usare?' })
      delete patch.totalDoughWeight
    } else if (patch.totalDoughWeight !== undefined) {
      patch.useTotalWeight = true
      patch.useAreaWeight = false
    } else if (patch.ballCount !== undefined || patch.ballWeight !== undefined) {
      patch.useTotalWeight = false
      patch.useAreaWeight = false
    }

    if (pantryConstraintActive && context.currentConfiguration.flourBlend.some(({ flourId }) => !context.pantryEntries.some((entry) => entry.flourId === flourId)) && !flourRequests.length) {
      ambiguities.push({ field: 'flourBlend', question: 'La miscela attuale contiene farine non presenti in dispensa. Scegli esplicitamente quali farine disponibili usare.', choices: context.pantryEntries.flatMap(({ flourId }) => { const flour = context.flours.find(({ id }) => id === flourId); return flour && isFlourBlendEligible(flour) ? [{ id: flour.id, label: `${flour.brand} · ${flour.name}` }] : [] }) })
    }

    const blendRequests = proposals.get('flourBlend.request')?.flatMap(({ value }) => isFlourRequest(value) ? [value] : []) ?? []
    if (completeFromPantry && pantryConstraintActive && blendRequests.length) {
      const requestedTotal = blendRequests.reduce((sum, item) => sum + item.percentage, 0)
      const remainder = 100 - requestedTotal
      if (remainder > 0) {
        const requestedIds = new Set(blendRequests.map(({ flourId }) => flourId))
        const pantryChoices = context.pantryEntries.flatMap(({ flourId }) => {
          if (requestedIds.has(flourId)) return []
          const flour = context.flours.find(({ id }) => id === flourId)
          return flour && isFlourBlendEligible(flour) ? [{ id: flour.id, label: `${flour.brand} · ${flour.name}` }] : []
        })
        if (pantryChoices.length === 1) blendRequests.push({ flourId: pantryChoices[0].id, percentage: remainder })
        else ambiguities.push({
          field: 'flourBlend',
          question: pantryChoices.length ? `Ci sono più farine in dispensa per il restante ${remainder}%. Quale vuoi usare?` : `Non ci sono farine disponibili in dispensa per completare il restante ${remainder}%.`,
          choices: pantryChoices,
          choicePercentage: remainder,
        })
      }
    }
    if (blendRequests.length && !ambiguities.some(({ field }) => field === 'flourBlend')) {
      const currentBlend = pantryConstraintActive
        ? context.currentConfiguration.flourBlend.filter(({ flourId }) => context.pantryEntries.some((entry) => entry.flourId === flourId))
        : context.currentConfiguration.flourBlend
      const blendResult = buildFlourBlend(currentBlend, blendRequests)
      if (blendResult.error) ambiguities.push({ field: 'flourBlend', question: blendResult.error })
      else {
        patch.flourBlend = blendResult.blend
        for (const request of proposals.get('flourBlend.request') ?? []) {
          if (!isFlourRequest(request.value)) continue
          const flourRequest = request.value
          const flour = context.flours.find(({ id }) => id === flourRequest.flourId)
          entities.push({ field: 'flourBlend', value: flour ? `${flour.brand} · ${flour.name} (${flourRequest.percentage}%)` : flourRequest.flourId, sourceText: request.sourceText, certainty: 'explicit' })
        }
      }
    }

    if (typeof patch.flourBlend !== 'undefined' && pantryConstraintActive && patch.flourBlend.some(({ flourId }) => !context.pantryEntries.some((entry) => entry.flourId === flourId))) {
      ambiguities.push({ field: 'flourBlend', question: 'La miscela proposta include una farina non presente in dispensa. Indica esplicitamente la sostituzione; non la scelgo al posto tuo.' })
      delete patch.flourBlend
    }

    synchronizeFermentationTemperatures(patch, context.currentConfiguration)
    if (patch.fermentation?.strategy && patch.fermentation.strategy !== context.currentConfiguration.fermentation.strategy) {
      try {
        const total = patch.fermentation.totalDurationMinutes ?? context.currentConfiguration.fermentation.totalDurationMinutes
        const templated = applyStrategyTemplate(context.currentConfiguration.fermentation, patch.fermentation.strategy, total)
        patch.fermentation = { ...patch.fermentation, phases: templated.phases, totalDurationMinutes: total, plannedStartAt: templated.plannedStartAt, bakingAt: patch.fermentation.bakingAt ?? templated.bakingAt }
      } catch (error) {
        validationErrors.push({ field: 'fermentation.strategy', message: error instanceof Error ? error.message : 'La strategia non è applicabile al piano attuale.' })
      }
    }

    if (validationErrors.length === 0 && Object.keys(patch).length) {
      const validation = validateRecipePatch(context.currentConfiguration, patch, context.flours)
      if (validation.ok) {
        const changesBakeAnchor = patch.fermentation?.bakingAt !== undefined || patch.fermentation?.totalDurationMinutes !== undefined
        if (changesBakeAnchor && Date.parse(validation.configuration.fermentation.plannedStartAt) < context.now.getTime()) {
          ambiguities.push({ field: 'fermentation.plannedStartAt', question: 'Con la durata attuale, la preparazione dovrebbe iniziare nel passato. Vuoi ridurre la durata della fermentazione o scegliere un orario di cottura più tardi?' })
        } else if (typeof patch.ballCount === 'number' && !Number.isInteger(patch.ballCount)) validationErrors.push({ field: 'ballCount', message: 'Il numero di panetti deve essere intero.' })
        else if (typeof patch.ballWeight === 'number' && !Number.isInteger(patch.ballWeight)) validationErrors.push({ field: 'ballWeight', message: 'Il peso del panetto deve essere espresso in grammi interi.' })
        else if (typeof patch.totalDoughWeight === 'number' && !Number.isInteger(patch.totalDoughWeight)) validationErrors.push({ field: 'totalDoughWeight', message: 'Il peso totale deve essere espresso in grammi interi.' })
        else if (conflictingFields.length === 0) proposedConfiguration = validation.configuration
      } else validationErrors.push(...validation.issues)
    }

    if (!recognized && !ambiguities.length) {
      const clarification = inferMissingClarification(normalizedText)
      if (clarification) ambiguities.push(clarification)
      else unsupportedRequests.push(makeUnsupportedRequest(text))
    } else if (flourRequests.length && resolvedFlours.every((matches) => matches.length === 0)) {
      unsupportedRequests.push({ text, explanation: 'Il prodotto indicato non corrisponde a una scheda del catalogo disponibile.', suggestion: 'Prova con la marca e il nome esatto riportati nel catalogo farine.' })
    }

    const intent = detectIntent(normalizedText, recognized, unsupportedRequests)
    const missingInformation = ambiguities.map(({ question }) => question)
    return {
      intent, normalizedText, patch, proposedConfiguration: validationErrors.length || ambiguities.length || unsupportedRequests.length ? null : proposedConfiguration ?? context.currentConfiguration,
      entities: deduplicateEntities(entities), missingInformation, ambiguities, validationErrors, unsupportedRequests, usePantryOnly: usePantryOnly ?? (pantryConstraintActive ? true : null),
    }
  }
}

export function normalizeItalianText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it-IT')
    .replace(/[’‘`']/g, ' ').replace(/(?<![\p{L}\p{N}])-(?=\d)/gu, ' negativenumber ')
    .replace(/[–—-]/g, ' ').replace(/[^\p{L}\p{N}%:.,/!?;\s]/gu, ' ').replace(/\bnegativenumber\s+(?=\d)/g, '-')
    .replace(/\s+/g, ' ').trim()
}

export const deterministicItalianInterpreter = new DeterministicItalianInterpreter()

function numberValue(token: string | undefined): number | undefined {
  if (!token) return undefined
  const normalized = token.replace(',', '.').trim()
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : NUMBER_WORDS[normalized]
}

function collectPercentage(text: string, template: RegExp, callback: (value: number, source: string) => void) {
  const expression = new RegExp(template.source.replaceAll('__NUMBER__', NUMBER_TOKEN), template.flags)
  for (const match of text.matchAll(expression)) {
    const token = match[1] ?? match[0].match(new RegExp(NUMBER_TOKEN))?.[0]
    const value = numberValue(token)
    if (value !== undefined) callback(value, match[0])
  }
}

function collectTemperature(text: string, template: RegExp, callback: (value: number, source: string) => void) {
  const expression = new RegExp(template.source.replaceAll('__NUMBER__', NUMBER_TOKEN), template.flags)
  for (const match of text.matchAll(expression)) {
    const value = numberValue(match[0].match(new RegExp(NUMBER_TOKEN))?.[0])
    if (value !== undefined) callback(value, match[0])
  }
}

function parseYeastType(text: string): { value: YeastType; source: string } | undefined {
  if (/\b(?:lievito\s+)?(?:secco\s+)?istantaneo\b/.test(text)) return { value: 'instant-dry', source: 'lievito secco istantaneo' }
  if (/\b(?:lievito\s+)?secco\s+attivo\b/.test(text)) return { value: 'active-dry', source: 'lievito secco attivo' }
  if (/\b(?:lievito\s+)?fresco\b/.test(text)) return { value: 'fresh', source: 'lievito fresco' }
  return undefined
}

function calculateFlourWeight(configuration: RecipeConfiguration): number | null {
  try { return calculateDough(toDoughInput(configuration)).flourWeight } catch { return null }
}

function parseStrategies(text: string): Array<{ value: FermentationStrategy; source: string }> {
  const strategies: Array<{ value: FermentationStrategy; source: string }> = []
  if (/\b(?:tutta|tutto)\s+(?:a\s+)?temperatura ambiente\b|\btemperatura ambiente\b|\blievitazione\s+ambientale\b/.test(text)) {
    strategies.push({ value: 'room-temperature', source: 'temperatura ambiente' })
  }
  if (/\b(?:ambiente\s*(?:\+|e)\s*frigo|combinata|combinato)\b/.test(text)) {
    strategies.push({ value: 'combined', source: 'ambiente e frigorifero' })
  }
  if (/\b(?:refrigerat[oa]s?|notte\s+(?:in\s+)?(?:frigorifero|frigo)|prevalentemente\s+(?:in\s+)?(?:frigorifero|frigo)|(?:lievitazione|fermentazione|maturazione)(?:\s+di\s+\d+(?:[.,]\d+)?\s+(?:ore|giorni?))?\s+(?:tutta\s+)?in\s+(?:frigorifero|frigo)|\d+(?:[.,]\d+)?\s+(?:ore|giorni?)\s+in\s+(?:frigorifero|frigo)|solo\s+frigo)\b/.test(text)) {
    strategies.push({ value: 'refrigerated', source: 'frigorifero' })
  }
  if (/\bpiano\s+personalizzato\b/.test(text)) strategies.push({ value: 'custom', source: 'piano personalizzato' })
  return [...new Map(strategies.map((strategy) => [strategy.value, strategy])).values()]
}

function parseAvailability(text: string, current: RecipeConfiguration['fermentation']['availability']): { value: RecipeConfiguration['fermentation']['availability']; source: string } | undefined {
  if (/\b(?:non ci sono|nessuna|nessun) fasce? orarie? da evitare\b/.test(text)) {
    return { value: { ...current, avoidRestHours: false }, source: 'nessuna fascia oraria da evitare' }
  }
  const clock = `(mezzanotte|${NUMBER_TOKEN}|\\d{1,2})(?::(\\d{2}))?`
  const range = new RegExp(`(?:tra|dalle)\\s+(?:le\\s+)?${clock}\\s+(?:e|alle)\\s+(?:le\\s+)?${clock}`)
  const match = text.match(range)
  if (match && /\b(?:staglio|lavorare|lavoro|lavorazioni|lavorazione|impastare|indisponibile|non posso|evita|senza|fuori casa|pianificare)\b/.test(text)) {
    const start = formatClock(clockValue(match[1]), Number(match[2] ?? 0))
    const end = formatClock(clockValue(match[3]), Number(match[4] ?? 0))
    return { value: { avoidRestHours: true, unavailableStart: start, unavailableEnd: end }, source: match[0] }
  }
  const after = text.match(new RegExp(`(?:senza\\s+(?:lavorare|fare\\s+operazioni)\\s+dopo|non\\s+(?:posso|voglio)\\s+(?:lavorare|fare\\s+operazioni)\\s+dopo)\\s+(?:le\\s+)?${clock}`))
  if (after) return { value: { ...current, avoidRestHours: true, unavailableStart: formatClock(Number(after[1]), Number(after[2] ?? 0)) }, source: after[0] }
  return undefined
}

function clockValue(value: string): number {
  return value === 'mezzanotte' ? 0 : numberValue(value) ?? Number(value)
}

function formatClock(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseFlourMentions(text: string): Array<{ name: string; percentage?: number; source: string }> {
  const requests: Array<{ name: string; percentage?: number; source: string }> = []
  const stop = '(?=\\s+(?:e|con|a|al|per|idratazione|temperatura|lievito|sale|olio|domani|oggi|dopodomani)\\b|[,!?;.]|$)'
  const percentPattern = new RegExp(`(${NUMBER_TOKEN})\\s*%\\s*(?:di\\s+|del\\s+|della\\s+)?(?:farina\\s+)?([\\p{L}0-9][\\p{L}0-9 ]*?)${stop}`, 'gu')
  for (const match of text.matchAll(percentPattern)) {
    const percentage = numberValue(match[1])
    if (percentage === undefined) continue
    const name = cleanFlourMention(match[2])
    if (name) requests.push({ name, percentage, source: match[0] })
  }
  const halfPattern = new RegExp(`\\bmeta\\s+([\\p{L}][\\p{L}0-9 ]*?)${stop}`, 'gu')
  for (const match of text.matchAll(halfPattern)) {
    const name = cleanFlourMention(match[1])
    if (name) requests.push({ name, percentage: 50, source: match[0] })
  }
  if (!requests.length && !/\bfarine?\s+(?:che\s+)?ho\s+(?:in\s+)?dispensa\b|\bsolo\s+farine\s+(?:disponibili|in\s+dispensa)\b/.test(text)) {
    const named = new RegExp(`\\b(?:usa|utilizza|scegli|metti|aggiungi)\\s+(?:il\\s+|la\\s+|una\\s+)?(?:farina\\s+)?([\\p{L}][\\p{L}0-9 ]*?)${stop}`, 'gu')
    for (const match of text.matchAll(named)) {
      const name = cleanFlourMention(match[1])
      if (!name || /^(?:solo )?(?:farine? )?(?:che ho )?(?:in )?dispensa$/.test(name) || /^(?:lievito|sale|olio|idratazione|frigo|frigorifero)$/.test(name)) continue
      if (!name.split(' ').some((token) => token.length > 2)) continue
      requests.push({ name, percentage: 100, source: match[0] })
    }
  }
  return requests
}

function inferMissingClarification(text: string): NaturalLanguageAmbiguity | undefined {
  if (/\b(?:molto idratat[oa]|piu morbida|piu idratat[oa]|un filo piu morbida)\b/.test(text)) {
    return { field: 'hydrationPct', question: 'Quale percentuale di idratazione vuoi impostare?' }
  }
  if (/\b(?:dose piccola|impasto piccolo|porzione piccola)\b/.test(text)) {
    return { field: 'doughWeight', question: 'Quanti panetti e di quale peso, oppure quale peso totale desideri?' }
  }
  if (/\b(?:poco lievito|meno lievito|poco piu lievito|mezzo grammo)\b/.test(text)) {
    return { field: 'yeastPct', question: 'Quale quantità o percentuale di lievito vuoi usare?' }
  }
  if (/\b(?:farina forte|farina qualsiasi|scegli tu una farina)\b/.test(text)) {
    return { field: 'flourBlend', question: 'Quale farina del catalogo vuoi usare? Indica marca e prodotto.' }
  }
  if (/\b(?:anzi|come prima|stessa ricetta|portala|portalo|togli il vincolo)\b/.test(text)) {
    return { field: 'context', question: 'Mi manca il riferimento della richiesta precedente. Quale parametro o vincolo vuoi modificare?' }
  }
  return undefined
}

function cleanFlourMention(value: string) {
  const cleaned = value.trim().replace(/^(?:di|del|della|dello|dei|degli|delle|una|un|il|lo|la|le|i|gli|farina|farine)\s+/g, '').trim()
  return GENERIC_FLOUR_WORDS.has(cleaned) ? '' : cleaned
}

function resolveFlour(name: string, flours: Flour[]): Flour[] {
  const normalizedName = normalizeItalianText(name).trim()
  const exact = flours.filter((flour) => normalizedName === normalizeItalianText(`${flour.brand} ${flour.name}`).trim())
  if (exact.length) return exact
  const tokens = normalizedName.split(' ').filter((token) => token.length > 1 && !GENERIC_FLOUR_WORDS.has(token))
  if (!tokens.length) return []
  const matches = flours.filter((flour) => {
    const source = normalizeItalianText(`${flour.brand} ${flour.name} ${flour.flourType} ${flour.officialSource?.brand ?? ''} ${flour.officialSource?.name ?? ''}`)
    return tokens.every((token) => source.includes(token))
  })
  const exactProducts = matches.filter((flour) => {
    const product = normalizeItalianText(flour.name).split(' ').filter(Boolean)
    return product.length <= tokens.length && tokens.slice(-product.length).join(' ') === product.join(' ')
  })
  return exactProducts.length ? exactProducts : matches
}

function isFlourRequest(value: unknown): value is FlourBlendItem {
  return typeof value === 'object' && value !== null && 'flourId' in value && 'percentage' in value
}

function buildFlourBlend(current: FlourBlendItem[], requested: FlourBlendItem[]): { blend?: FlourBlendItem[]; error?: string } {
  if (requested.some(({ percentage }) => percentage < 0 || percentage > 100)) return { error: 'La percentuale di farina deve essere compresa tra 0 e 100%.' }
  const requestedTotal = requested.reduce((sum, item) => sum + item.percentage, 0)
  if (requestedTotal > 100) return { error: 'Le percentuali esplicite della miscela superano il 100%. Correggi le quote.' }
  const requestedIds = new Set(requested.map(({ flourId }) => flourId))
  const remainder = 100 - requestedTotal
  const others = current.filter(({ flourId }) => !requestedIds.has(flourId))
  if (remainder > 0 && !others.length) return { error: `Hai indicato il ${requestedTotal}% di una sola farina. Quale farina vuoi usare per il restante ${remainder}%?` }
  const otherTotal = others.reduce((sum, item) => sum + item.percentage, 0)
  const blend = [...requested.map((item) => ({ ...item }))]
  for (const item of others) blend.push({ ...item, percentage: otherTotal ? item.percentage / otherTotal * remainder : remainder / others.length })
  return { blend }
}

function parseBakingDateTime(text: string, context: NaturalLanguageContext): { value?: string; source: string; error?: string } {
  const timeMatches = [...text.matchAll(/\b(?:alle|all|a|ore)\s+(\d{1,2})(?::([0-5]\d)|\.([0-5]\d))?\b(?!\s*(?:gradi|celsius))/g)]
    .filter((match) => Number(match[1]) <= 23)
  const colloquialTime = text.match(/\balle\s+(otto|sette|sei|nove|dieci|undici|dodici)\s+e\s+mezza\b/)
  if (timeMatches.length + Number(Boolean(colloquialTime)) > 1) return { source: text, error: 'Hai indicato più orari di cottura. Quale data e ora devo usare?' }
  const timeMatch = timeMatches[0]
  const colloquialHour = colloquialTime ? numberValue(colloquialTime[1]) : undefined
  const requestedHour = colloquialHour === undefined ? undefined : /\bsera\b/.test(text) && colloquialHour < 12 ? colloquialHour + 12 : colloquialHour
  const requestedMinute = colloquialTime ? 30 : undefined
  const relativeDays = text.match(new RegExp(`\\b(?:tra|fra)\\s+(${NUMBER_TOKEN})\\s+giorni?\\b`))
  const hasDate = Boolean(relativeDays) || /(?:oggi|domani|dopodomani|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/.test(text)
  if (!timeMatch && !colloquialTime && !hasDate) return { source: '' }
  if (!timeMatch && !colloquialTime && hasDate && /\b(?:ora di cena|orario di cena|ora della cena|per cena|a cena)\b/.test(text)) {
    return { source: text, error: 'Per “ora di cena” posso usare le 20:00, ma non la imposto senza conferma. Va bene questo orario?' }
  }
  if (hasDate && !timeMatch && !colloquialTime) return { source: text, error: 'Hai indicato il giorno ma non l’orario di cottura. A che ora deve essere pronta?' }
  const baking = new Date(context.currentConfiguration.fermentation.bakingAt)
  const fallback = Number.isFinite(baking.getTime()) ? partsInZone(baking, context.timeZone) : partsInZone(context.now, context.timeZone)
  const today = partsInZone(context.now, context.timeZone)
  const target = hasDate ? resolveCalendarDate(text, today) : { year: fallback.year, month: fallback.month, day: fallback.day }
  if (!target) return { source: text, error: 'Non riesco a determinare la data. Indica una data completa oppure oggi, domani o un giorno della settimana.' }
  const hour = timeMatch ? Number(timeMatch[1]) : requestedHour ?? fallback.hour
  const minute = timeMatch ? Number(timeMatch[2] ?? timeMatch[3] ?? 0) : requestedMinute ?? fallback.minute
  if (hour > 23 || minute > 59) return { source: timeMatch?.[0] ?? text, error: 'L’orario deve essere compreso tra 00:00 e 23:59.' }
  const result = zonedDateTimeToIso({ ...target, hour, minute }, context.timeZone)
  if (result.error) return { source: timeMatch?.[0] ?? text, error: result.error }
  return { value: result.iso, source: [hasDate ? relativeDays?.[0] ?? text.match(/oggi|domani|dopodomani|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/)?.[0] : '', timeMatch?.[0] ?? colloquialTime?.[0] ?? 'ora attuale'].filter(Boolean).join(' ') }
}

interface CalendarParts { year: number; month: number; day: number; hour: number; minute: number }

function resolveCalendarDate(text: string, today: CalendarParts): Pick<CalendarParts, 'year' | 'month' | 'day'> | undefined {
  const relativeDays = text.match(new RegExp(`\\b(?:tra|fra)\\s+(${NUMBER_TOKEN})\\s+giorni?\\b`))
  if (relativeDays) {
    const days = numberValue(relativeDays[1])
    if (days !== undefined && days > 0 && days <= 365) return addCalendarDays(today, days)
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  if (iso) return checkedCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  if (numeric) return checkedCalendarDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))
  const offset = /\bdopodomani\b/.test(text) ? 2 : /\bdomani\b/.test(text) ? 1 : /\boggi\b/.test(text) ? 0 : undefined
  if (offset !== undefined) return addCalendarDays(today, offset)
  const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b`).test(text))
  if (weekday < 0) return undefined
  const currentName = normalizeItalianText(new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', weekday: 'long' }).format(new Date(Date.UTC(today.year, today.month - 1, today.day))))
  const current = WEEKDAYS.indexOf(currentName)
  const delta = (weekday - current + 7) % 7 || 7
  return addCalendarDays(today, delta)
}

function addCalendarDays(date: Pick<CalendarParts, 'year' | 'month' | 'day'>, days: number) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }
}

function checkedCalendarDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return undefined
  return { year, month, day }
}

function partsInZone(date: Date, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour') % 24, minute: value('minute') }
}

function zonedDateTimeToIso(local: CalendarParts, timeZone: string): { iso?: string; error?: string } {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0))
  } catch {
    return { error: `Il fuso orario “${timeZone}” non è valido.` }
  }
  const localEpoch = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  const offsets = new Set<number>()
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = new Date(localEpoch + hours * 3_600_000)
    const parts = partsInZone(sample, timeZone)
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - sample.getTime())
  }
  const matches = [...offsets].map((offset) => new Date(localEpoch - offset)).filter((candidate) => sameLocalParts(partsInZone(candidate, timeZone), local))
  if (!matches.length) return { error: 'Quell’orario locale non esiste nel fuso indicato per il cambio stagionale. Scegli un altro orario.' }
  if (matches.length > 1) return { error: 'Quell’orario locale si ripete per il cambio stagionale. Indica un orario non ambiguo.' }
  return { iso: matches[0].toISOString() }
}

function sameLocalParts(left: CalendarParts, right: CalendarParts) {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute
}

function synchronizeFermentationTemperatures(patch: RecipePatch, current: RecipeConfiguration) {
  const fermentation = patch.fermentation
  if (!fermentation) return
  const ambient = fermentation.ambientTemperatureC
  const refrigerator = fermentation.refrigeratorTemperatureC
  if (ambient === undefined && refrigerator === undefined) return
  const basePhases = fermentation.phases ?? current.fermentation.phases
  fermentation.phases = basePhases.map((phase) => ({
    ...phase,
    ...(ambient !== undefined && phase.environment === 'ambient' ? { temperatureC: ambient } : {}),
    ...(refrigerator !== undefined && phase.environment === 'refrigerator' ? { temperatureC: refrigerator } : {}),
  }))
}

function assignPatch(patch: RecipePatch, field: string, value: unknown) {
  if (field.startsWith('fermentation.')) {
    patch.fermentation = patch.fermentation ?? {}
    const key = field.slice('fermentation.'.length) as keyof FermentationPatch
    ;(patch.fermentation as Record<string, unknown>)[key] = value
  } else if (field !== 'flourBlend.request') {
    ;(patch as Record<string, unknown>)[field] = value
  }
}

function entityValue(value: unknown): string | number | boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function fieldLabel(field: string) {
  return ({ hydrationPct: 'idratazione', saltPct: 'sale', oilPct: 'olio', yeastPct: 'lievito', ballCount: 'numero di panetti', ballWeight: 'peso del panetto', totalDoughWeight: 'peso totale', style: 'stile', 'fermentation.bakingAt': 'cottura' } as Record<string, string>)[field] ?? field.replaceAll('.', ' ')
}

function deduplicateEntities(entities: NaturalLanguageEntity[]) {
  const seen = new Set<string>()
  return entities.filter((entity) => {
    const key = `${entity.field}:${JSON.stringify(entity.value)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function detectIntent(text: string, recognized: boolean, unsupported: UnsupportedRequest[]): NaturalLanguageInterpretation['intent'] {
  if (!recognized && unsupported.length) return 'unsupported'
  if (/\b(?:che succede se|cosa cambia se|posso|e se)\b/.test(text)) return 'question'
  if (/\b(?:voglio|vorrei|preparo|preparare|fare|fammi|crea)\b/.test(text)) return 'configure'
  return recognized ? 'modify' : 'unsupported'
}

function makeUnsupportedRequest(text: string): UnsupportedRequest {
  return {
    text,
    explanation: 'Non ho trovato parametri che posso interpretare con sicurezza. Non applico modifiche.',
    suggestion: 'Prova con una richiesta come “Aumenta l’idratazione al 70%” oppure “Sposta la cottura a domani alle 20:30”.',
  }
}