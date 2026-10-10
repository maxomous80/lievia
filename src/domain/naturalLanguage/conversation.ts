import { cloneRecipeConfiguration, type RecipeConfiguration } from '../lab/scenarios'
import type { NaturalLanguageContext, NaturalLanguageInterpretation, NaturalLanguageInterpreter } from './types'

export interface NaturalLanguageMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
}

export interface NaturalLanguageConversation {
  baseline: RecipeConfiguration
  configuration: RecipeConfiguration
  messages: NaturalLanguageMessage[]
  undoStack: Array<{ configuration: RecipeConfiguration; explicitFields: string[]; pantryOnly: boolean }>
  lastInterpretation: NaturalLanguageInterpretation | null
  explicitFields: string[]
  pantryOnly: boolean
}

export function createConversation(configuration: RecipeConfiguration): NaturalLanguageConversation {
  const baseline = cloneRecipeConfiguration(configuration)
  return { baseline, configuration: cloneRecipeConfiguration(baseline), messages: [], undoStack: [], lastInterpretation: null, explicitFields: [], pantryOnly: false }
}

export function submitConversationRequest(
  conversation: NaturalLanguageConversation,
  text: string,
  interpreter: NaturalLanguageInterpreter,
  context: Omit<NaturalLanguageContext, 'currentConfiguration'>,
): NaturalLanguageConversation {
  const request = text.trim()
  if (!request) return conversation
  const interpretation = interpreter.interpret(request, { ...context, currentConfiguration: conversation.configuration, pantryOnly: conversation.pantryOnly })
  const messages = [...conversation.messages, { id: nextMessageId(conversation.messages), role: 'user' as const, text: request }]
  const canApplyProposal = Boolean(interpretation.proposedConfiguration && Object.keys(interpretation.patch).length > 0 &&
    interpretation.validationErrors.length === 0 && interpretation.ambiguities.length === 0 && interpretation.unsupportedRequests.length === 0)
  if (!canApplyProposal || !interpretation.proposedConfiguration) {
    return {
      ...conversation,
      messages: [...messages, { id: nextMessageId(messages), role: 'assistant', text: responseFor(interpretation) }],
      lastInterpretation: interpretation,
      pantryOnly: interpretation.usePantryOnly ?? conversation.pantryOnly,
    }
  }
  return {
    ...conversation,
    configuration: cloneRecipeConfiguration(interpretation.proposedConfiguration),
    undoStack: [...conversation.undoStack, { configuration: cloneRecipeConfiguration(conversation.configuration), explicitFields: conversation.explicitFields, pantryOnly: conversation.pantryOnly }],
    messages: [...messages, { id: nextMessageId(messages), role: 'assistant', text: 'Ho aggiornato la proposta. Rivedila prima di applicarla: non ho modificato ricette salvate.' }],
    lastInterpretation: interpretation,
    explicitFields: [...new Set([...conversation.explicitFields, ...interpretation.entities.map(({ field }) => field)])],
    pantryOnly: interpretation.usePantryOnly ?? conversation.pantryOnly,
  }
}

export function undoConversationChange(conversation: NaturalLanguageConversation): NaturalLanguageConversation {
  const previous = conversation.undoStack.at(-1)
  if (!previous) {
    const message = 'Non ci sono modifiche proposte da annullare.'
    return { ...conversation, messages: [...conversation.messages, { id: nextMessageId(conversation.messages), role: 'assistant', text: message }] }
  }
  const undoStack = conversation.undoStack.slice(0, -1)
  const messages = [...conversation.messages, { id: nextMessageId(conversation.messages), role: 'assistant' as const, text: 'Ultima modifica proposta annullata.' }]
  return { ...conversation, configuration: cloneRecipeConfiguration(previous.configuration), undoStack, messages, explicitFields: previous.explicitFields, pantryOnly: previous.pantryOnly }
}

export function resetConversation(conversation: NaturalLanguageConversation): NaturalLanguageConversation {
  return createConversation(conversation.baseline)
}

function responseFor(result: NaturalLanguageInterpretation): string {
  if (result.validationErrors.length) return 'Non applico la proposta: alcuni valori non sono validi. Correggi i campi segnalati.'
  if (result.ambiguities.length) return 'Mi serve una precisazione prima di aggiornare la proposta.'
  if (result.unsupportedRequests.length) return result.unsupportedRequests[0].explanation
  if (result.usePantryOnly) return 'Ho rilevato il vincolo dispensa. Verifica o scegli esplicitamente le farine da usare.'
  return 'Non ho modificato la proposta: scrivi il parametro e il valore che vuoi cambiare.'
}

function nextMessageId(messages: NaturalLanguageMessage[]) {
  return (messages.at(-1)?.id ?? 0) + 1
}