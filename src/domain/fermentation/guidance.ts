import type { FermentationConfig, FermentationWarning, FlourGuidanceInput } from './types'

export function getTemperatureGuidance(config: FermentationConfig): FermentationWarning[] {
  const warnings: FermentationWarning[] = []
  if (config.ambientTemperatureC < 5 || config.ambientTemperatureC > 30) {
    warnings.push({
      code: 'ambient-temperature-extreme',
      message: 'La temperatura ambiente inserita è insolita per la gestione di un impasto: verifica il dato e osserva frequentemente la massa.',
      basis: 'temperatura inserita',
    })
  }
  if (config.refrigeratorTemperatureC < 0 || config.refrigeratorTemperatureC > 10) {
    warnings.push({
      code: 'refrigerator-temperature-check',
      message: 'La temperatura del frigorifero è fuori dall’intervallo usuale di conservazione fredda: verifica la misura. La fermentazione rallenta, ma non si arresta.',
      basis: 'temperatura inserita',
    })
  }
  if (config.measuredDoughTemperatureC !== undefined && Math.abs(config.measuredDoughTemperatureC - config.ambientTemperatureC) >= 5) {
    warnings.push({
      code: 'dough-ambient-temperature-difference',
      message: 'La temperatura misurata dell’impasto differisce dall’ambiente: usa la misura dell’impasto come osservazione distinta, non come equivalente della stanza.',
      basis: 'temperatura inserita',
    })
  }
  if (config.totalDurationMinutes > 48 * 60) {
    warnings.push({
      code: 'long-fermentation',
      message: 'Piano superiore a 48 ore: è una finestra di lavoro, non una previsione della fermentazione. Verifica spesso l’impasto.',
      basis: 'orientamento generale',
    })
  }
  return warnings
}

export function getFlourGuidance(input: FlourGuidanceInput): FermentationWarning[] {
  const warnings: FermentationWarning[] = []
  const selected = input.blend.map((item) => ({
    item,
    flour: input.flours.find((flour) => flour.id === item.flourId),
  })).filter(({ item }) => item.percentage > 0)
  const unknown = selected.filter(({ flour }) => !flour)
  const withoutW = selected.filter(({ flour }) => flour?.strengthW === undefined)
  const withoutProtein = selected.filter(({ flour }) => flour?.proteinPct === undefined)
  if (unknown.length || withoutW.length || withoutProtein.length) {
    warnings.push({
      code: 'flour-data-incomplete',
      message: 'W e/o proteine non sono disponibili per tutte le farine della miscela: la compatibilità con il piano non è stimabile. I profili demo non hanno specifiche commerciali.',
      basis: 'dati farina inseriti',
    })
  }
  const measuredW = selected.every(({ flour }) => flour?.strengthW !== undefined)
    ? selected.reduce((total, { item, flour }) => total + item.percentage * (flour?.strengthW ?? 0) / 100, 0)
    : undefined
  if (measuredW !== undefined && measuredW < 200 && input.durationMinutes > 24 * 60) {
    warnings.push({
      code: 'long-plan-lower-strength',
      message: `La forza W inserita (media ponderata ≈ ${Math.round(measuredW)}) è relativamente contenuta rispetto a un piano oltre 24 ore. Valuta la tenuta dell’impasto: W da sola non determina un tempo di fermentazione sicuro.`,
      basis: 'dati farina inseriti',
    })
  }
  if (input.hydrationPct >= 80 && withoutProtein.length) {
    warnings.push({
      code: 'high-hydration-unknown-absorption',
      message: 'Idratazione elevata con capacità di assorbimento non documentata per tutta la miscela: procedi gradualmente e osserva l’impasto.',
      basis: 'orientamento generale',
    })
  }
  if (input.durationMinutes > 48 * 60) {
    warnings.push({
      code: 'very-long-plan',
      message: 'Piano superiore a 48 ore: controlla regolarmente l’evoluzione. Le durate sono una pianificazione, non una previsione biologica.',
      basis: 'orientamento generale',
    })
  }
  if (input.style === 'napoletana' && input.hydrationPct > 75) {
    warnings.push({
      code: 'style-hydration-check',
      message: 'Idratazione superiore al valore comunemente gestibile nello stile selezionato: verifica la lavorabilità, senza considerare questa nota un limite tecnico.',
      basis: 'orientamento generale',
    })
  }
  return warnings
}