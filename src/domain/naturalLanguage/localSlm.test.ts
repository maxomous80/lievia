import { describe, expect, it, vi } from 'vitest'
import { OFFICIAL_FLOURS } from '../../data/officialFlours'
import { isFlourBlendEligible } from '../flours/blendProperties'
import { createBenchmarkContext, summarizeInterpretation } from './benchmark'
import {
  checkLocalSLMCapability,
  interpretConservatively,
  interpretWithDeterministicFallback,
  LocalSLMInterpreter,
  parseLocalSLMOutput,
} from './localSlm'
import { isLocalSLMBenchmarkEnabled } from './slmFeatureFlag'

function output(status: string, patch: unknown, message = 'Proposta di prova'): string {
  return JSON.stringify({ status, patch, message })
}

describe('interprete SLM locale sperimentale', () => {
  it('rifiuta JSON malformato e proprietà aggiuntive', () => {
    const context = createBenchmarkContext()
    expect(parseLocalSLMOutput('{no json', context).status).toBe('invalid')
    expect(parseLocalSLMOutput(JSON.stringify({ status: 'candidate', patch: { hydrationPct: 70, yeastPct: 3 }, message: 'ok' }), context).status).toBe('invalid')
    expect(parseLocalSLMOutput(JSON.stringify({ status: 'candidate', patch: {}, message: 'ok', html: '<b>no</b>' }), context).status).toBe('invalid')
  })

  it('accetta un’astensione strutturata senza produrre configurazioni', () => {
    const result = parseLocalSLMOutput(output('unsupported', {}, '<script>alert(1)</script>'), createBenchmarkContext())
    expect(result.status).toBe('unsupported')
    expect(result.proposedConfiguration).toBeNull()
    expect(result.message).toBe('<script>alert(1)</script>')
  })

  it('rifiuta farine inventate e patch fuori dai limiti', () => {
    const context = createBenchmarkContext()
    expect(parseLocalSLMOutput(output('candidate', { flourBlend: [{ flourId: 'official:inventata', percentage: 100 }] }), context).validationErrors[0])
      .toMatch(/catalogo/)
    expect(parseLocalSLMOutput(output('candidate', { hydrationPct: 400 }), context).status).toBe('invalid')
  })

  it('restituisce una proposta validata senza mutare la configurazione corrente', () => {
    const context = createBenchmarkContext()
    const before = structuredClone(context.currentConfiguration)
    const flour = OFFICIAL_FLOURS.find(isFlourBlendEligible)
    const result = parseLocalSLMOutput(output('candidate', { hydrationPct: 70, flourBlend: [{ flourId: flour!.id, percentage: 100 }] }), context)
    expect(result.status).toBe('candidate')
    expect(result.proposedConfiguration?.hydrationPct).toBe(70)
    expect(result.proposedConfiguration?.flourBlend[0].flourId).toBe(flour!.id)
    expect(context.currentConfiguration).toEqual(before)
    expect(result.proposedConfiguration).not.toBe(context.currentConfiguration)
  })

  it('mantiene il testo del modello come testo e limita la lunghezza', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const result = parseLocalSLMOutput(output('clarify', {}, payload), createBenchmarkContext())
    expect(result.message).toBe(payload)
    expect(result.rawOutput.length).toBeLessThanOrEqual(1500)
  })

  it('dismette il runtime se il caricamento WebGPU non è supportato', async () => {
    const dispose = vi.fn()
    const interpreter = new LocalSLMInterpreter(() => ({
      load: async () => { throw new Error('WebGPU non disponibile') },
      generate: async () => '',
      dispose,
    }))
    await expect(interpreter.load(() => undefined, new AbortController().signal)).rejects.toThrow('WebGPU non disponibile')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('ricade sulla deterministica quando l’inferenza locale fallisce', async () => {
    const context = createBenchmarkContext()
    const local = { interpret: async () => { throw new Error('memoria GPU esaurita') } }
    const outcome = await interpretWithDeterministicFallback('Porta l’idratazione al 70%.', context, local, new AbortController().signal)
    expect(outcome.source).toBe('deterministic-fallback')
    if (outcome.source === 'deterministic-fallback') {
      expect(outcome.reason).toContain('memoria GPU')
      expect(outcome.result.patch.hydrationPct).toBe(70)
    }
  })

  it('esegue prima il parser e non avvia il modello per una patch deterministica risolta', async () => {
    const interpret = vi.fn()
    const context = createBenchmarkContext()
    const result = await interpretConservatively('Porta l’idratazione al 70%.', context, { interpret }, new AbortController().signal)
    expect(result.source).toBe('deterministic')
    expect(result.result.patch.hydrationPct).toBe(70)
    expect(interpret).not.toHaveBeenCalled()
  })

  it('non delega al modello una scelta di farina ambigua', async () => {
    const interpret = vi.fn()
    const result = await interpretConservatively('Usa Caputo.', createBenchmarkContext(), { interpret }, new AbortController().signal)
    expect(result.source).toBe('deterministic')
    expect(result.deterministic.ambiguities.some(({ field }) => field === 'flourBlend')).toBe(true)
    expect(interpret).not.toHaveBeenCalled()
  })

  it('chiede chiarimento deterministico per il prompt senza ora e non delega al modello', async () => {
    const interpret = vi.fn()
    const result = await interpretConservatively(
      'trova tu la combinazione migliore per avere 4 pizze da 250 grammi domani sera',
      createBenchmarkContext(),
      { interpret },
      new AbortController().signal,
    )
    expect(result.source).toBe('deterministic')
    expect(result.deterministic.patch.ballCount).toBe(4)
    expect(result.deterministic.patch.ballWeight).toBe(250)
    expect(result.deterministic.ambiguities.some(({ field }) => field === 'fermentation.bakingAt')).toBe(true)
    expect(result.deterministic.proposedConfiguration).toBeNull()
    expect(summarizeInterpretation(result.deterministic).clarificationQuestions).toContainEqual({
      field: 'fermentation.bakingAt',
      question: expect.stringContaining('ora'),
    })
    expect(interpret).not.toHaveBeenCalled()
  })

  it('non invoca il modello per il prompt completo con “ora di cena”', async () => {
    const interpret = vi.fn()
    const result = await interpretConservatively(
      'Trova tu la combinazione migliore per avere 4 pizze da 250 grammi domani sera per ora di cena.',
      createBenchmarkContext(),
      { interpret },
      new AbortController().signal,
    )
    expect(result.source).toBe('deterministic')
    if (result.source === 'deterministic') {
      expect(result.result.patch.ballCount).toBe(4)
      expect(result.result.patch.ballWeight).toBe(250)
      expect(result.result.ambiguities.some(({ field }) => field === 'fermentation.bakingAt')).toBe(true)
    }
    expect(interpret).not.toHaveBeenCalled()
  })

  it('ricade sul parser se il modello restituisce JSON malformato', async () => {
    const context = createBenchmarkContext()
    const local = { interpret: async () => parseLocalSLMOutput('Tu la combinazione migliora tuaziente 250 grammi su 250 grammi', context) }
    const result = await interpretConservatively('xyzzy', context, local, new AbortController().signal)
    expect(result.source).toBe('deterministic-fallback')
    if (result.source === 'deterministic-fallback') {
      expect(result.reason).toContain('JSON valido')
      expect(result.result.intent).toBe('unsupported')
    }
  })

  it('rifiuta una proposta SLM in conflitto con un campo esplicito e non la seleziona', async () => {
    const context = createBenchmarkContext()
    const interpret = vi.fn(async () => parseLocalSLMOutput(output('candidate', { saltPct: 4 }), context))
    const local = { interpret }
    const result = await interpretConservatively('Metti il 2% di sale, anzi il 4%.', context, local, new AbortController().signal)
    expect(result.source).toBe('deterministic')
    if (result.source === 'deterministic') {
      expect(result.result.ambiguities.some(({ field }) => field === 'saltPct')).toBe(true)
      expect(result.result.proposedConfiguration).toBeNull()
    }
    expect(interpret).not.toHaveBeenCalled()
  })

  it('usa direttamente il chiarimento deterministico quando il parser rileva una data incompleta', async () => {
    const interpret = vi.fn(async () => { throw new Error('GPU failure') })
    const local = { interpret }
    const result = await interpretConservatively('Cuoci domani.', createBenchmarkContext(), local, new AbortController().signal)
    expect(result.source).toBe('deterministic')
    expect(result.result.proposedConfiguration).toBeNull()
    expect(result.deterministic.ambiguities.some(({ field }) => field === 'fermentation.bakingAt')).toBe(true)
    expect(interpret).not.toHaveBeenCalled()
  })

  it('mantiene il benchmark disabilitato senza il flag developer e controlla le capability', () => {
    expect(isLocalSLMBenchmarkEnabled(undefined)).toBe(false)
    expect(isLocalSLMBenchmarkEnabled('false')).toBe(false)
    expect(isLocalSLMBenchmarkEnabled('true')).toBe(true)
    expect(checkLocalSLMCapability({ secureContext: true, webGPUAvailable: false }).code).toBe('unsupported-browser')
    expect(checkLocalSLMCapability({ secureContext: true, webGPUAvailable: true, deviceMemoryGb: 2 }).code).toBe('insufficient-memory')
    expect(checkLocalSLMCapability({ secureContext: true, webGPUAvailable: true }).supported).toBe(true)
    expect(checkLocalSLMCapability({ secureContext: false, webGPUAvailable: true }).code).toBe('secure-context')
  })
})