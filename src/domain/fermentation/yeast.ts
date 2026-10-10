import type { YeastType } from '../../models'
import type { FermentationConfig } from './types'

export interface YeastEstimateInput {
  yeastType: YeastType
  flourMassGrams: number
  config: FermentationConfig
}

export interface YeastEstimate {
  available: false
  modelVersion: 'un-calibrated'
  message: 'Stima automatica non ancora calibrata'
  limitations: string[]
}

export interface YeastConversionFactors {
  freshPerInstantDry?: number
  freshPerActiveDry?: number
}

export interface YeastConversion {
  available: boolean
  amount: number | null
  reason?: string
}

export function estimateYeast(_input: YeastEstimateInput): YeastEstimate {
  return {
    available: false,
    modelVersion: 'un-calibrated',
    message: 'Stima automatica non ancora calibrata',
    limitations: [
      'Non è disponibile un modello empirico documentato con coefficienti e riferimenti tracciabili.',
      'Temperatura dell’impasto, vitalità del lievito, farina e gestione reale introducono variabilità.',
      'Nessuna raccomandazione numerica viene dedotta dalla sola forza W o da una legge lineare della temperatura.',
    ],
  }
}

export function convertYeastDose(
  amount: number,
  from: YeastType,
  to: YeastType,
  factors: YeastConversionFactors,
): YeastConversion {
  if (!Number.isFinite(amount) || amount < 0) {
    return { available: false, amount: null, reason: 'La quantità deve essere un numero non negativo.' }
  }
  if (from === to) return { available: true, amount }

  const freshPerGram: Record<YeastType, number | undefined> = {
    fresh: 1,
    'instant-dry': factors.freshPerInstantDry,
    'active-dry': factors.freshPerActiveDry,
  }
  const fromFactor = freshPerGram[from]
  const toFactor = freshPerGram[to]
  if (fromFactor === undefined || toFactor === undefined) {
    return { available: false, amount: null, reason: 'Inserisci i rapporti di conversione espliciti prima di convertire.' }
  }
  if (![fromFactor, toFactor].every((factor) => Number.isFinite(factor) && factor > 0)) {
    return { available: false, amount: null, reason: 'I rapporti di conversione devono essere numeri positivi.' }
  }
  return { available: true, amount: amount * fromFactor / toFactor }
}

export function yeastPercentageForMassBalance(
  yeastGrams: number,
  totalDoughWeight: number,
  otherIngredientPercentages: number,
): number | null {
  if (![yeastGrams, totalDoughWeight, otherIngredientPercentages].every(Number.isFinite) ||
    yeastGrams < 0 || totalDoughWeight <= yeastGrams || otherIngredientPercentages < 0) return null
  return yeastGrams * (1 + otherIngredientPercentages / 100) / (totalDoughWeight - yeastGrams) * 100
}