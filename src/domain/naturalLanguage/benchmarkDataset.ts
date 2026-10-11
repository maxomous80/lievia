import type { Flour } from '../../models'
import { isFlourBlendEligible } from '../flours/blendProperties'
import type { RecipePatch } from '../lab/scenarios'

export interface NaturalLanguageBenchmarkCase {
  id: string
  category: string
  prompt: string
  expectedPatch: Partial<RecipePatch>
  expectAmbiguity?: boolean
  expectUnsupported?: boolean
  expectInvalid?: boolean
  expectedPantryOnly?: boolean | null
}

function item(
  id: string,
  category: string,
  prompt: string,
  expectedPatch: Partial<RecipePatch> = {},
  flags: Omit<NaturalLanguageBenchmarkCase, 'id' | 'category' | 'prompt' | 'expectedPatch'> = {},
): NaturalLanguageBenchmarkCase {
  return { id, category, prompt, expectedPatch, ...flags }
}

export function createNaturalLanguageBenchmarkDataset(flours: Flour[]): NaturalLanguageBenchmarkCase[] {
  const caputoNuvola = flours.find(({ brand, name }) => /caputo/i.test(brand) && /nuvola/i.test(name))
  const caputoPizzeria = flours.find(({ brand, name }) => /caputo/i.test(brand) && /pizzeria/i.test(name))
  const baselineFlour = getBenchmarkBaselineFlour(flours, getBenchmarkTargetFlourIds(flours))
  const nuvolaPrompt = caputoNuvola ? `${caputoNuvola.brand} ${caputoNuvola.name}` : 'Caputo Nuvola'
  const pizzeriaPrompt = caputoPizzeria ? `${caputoPizzeria.brand} ${caputoPizzeria.name}` : 'Caputo Pizzeria'
  const blendWithBaseline = (flour: Flour | undefined, percentage: number) => flour && baselineFlour
    ? [{ flourId: flour.id, percentage }, { flourId: baselineFlour.id, percentage: 100 - percentage }]
    : []

  return [
    item('basic-01', 'basics', 'Voglio fare 6 panetti.', { ballCount: 6 }),
    item('basic-02', 'basics', 'Prepara quattro pizze.', { ballCount: 4 }),
    item('basic-03', 'basics', 'Mi servono 8 palline da 220 grammi.', { ballCount: 8, ballWeight: 220 }),
    item('basic-04', 'basics', 'Fai 3 panetti da 280 g.', { ballCount: 3, ballWeight: 280 }),
    item('basic-05', 'basics', 'Porta l’idratazione al 70%.', { hydrationPct: 70 }),
    item('basic-06', 'basics', 'Metti il 68,5% di acqua.', { hydrationPct: 68.5 }),
    item('basic-07', 'basics', 'Imposta il sale al 2,8 per cento.', { saltPct: 2.8 }),
    item('basic-08', 'basics', 'Aggiungi il 3% di olio.', { oilPct: 3 }),
    item('basic-09', 'basics', 'Impasto complessivo da 1,2 kg.', { useTotalWeight: true, totalDoughWeight: 1200 }),
    item('basic-10', 'basics', 'Vorrei un chilo e mezzo di impasto totale.', { useTotalWeight: true, totalDoughWeight: 1500 }),
    item('basic-11', 'basics', 'Passa allo stile napoletano.', { style: 'napoletana' }),
    item('basic-12', 'basics', 'Vorrei una pizza contemporanea.', { style: 'contemporanea' }),
    item('basic-13', 'basics', 'Aumenta l’idratazione al 72% e il sale al 2,5%.', { hydrationPct: 72, saltPct: 2.5 }),
    item('basic-14', 'basics', 'Riduci l’olio all’1,5%.', { oilPct: 1.5 }),
    item('compound-01', 'compound', 'Sei panetti da 250 grammi e idratazione al 70%.', { ballCount: 6, ballWeight: 250, hydrationPct: 70 }),
    item('compound-02', 'compound', 'Fai 5 pizze al 68% di idratazione e 2,7% di sale.', { ballCount: 5, hydrationPct: 68, saltPct: 2.7 }),
    item('compound-03', 'compound', 'Porta l’idratazione al 71%, metti il 2% di olio e 3% di sale.', { hydrationPct: 71, oilPct: 2, saltPct: 3 }),
    item('compound-04', 'compound', 'Otto panetti da 230 g, impasto al 69% e sale al 2,6%.', { ballCount: 8, ballWeight: 230, hydrationPct: 69, saltPct: 2.6 }),
    item('compound-05', 'compound', 'Per due pizze da 300 grammi porta l’idratazione al 75%.', { ballCount: 2, ballWeight: 300, hydrationPct: 75 }),
    item('compound-06', 'compound', 'Impasto totale 900 g con idratazione al 65%.', { useTotalWeight: true, totalDoughWeight: 900, hydrationPct: 65 }),
    item('compound-07', 'compound', 'Metti 7 panetti, 250 g ciascuno, e il 2,5% di sale.', { ballCount: 7, ballWeight: 250, saltPct: 2.5 }),
    item('compound-08', 'compound', 'Stile contemporaneo, 4 palline da 260 grammi.', { style: 'contemporanea', ballCount: 4, ballWeight: 260 }),
    item('compound-09', 'compound', 'Facciamo 6 panetti, idratazione al 70% e olio al 2%.', { ballCount: 6, hydrationPct: 70, oilPct: 2 }),
    item('compound-10', 'compound', 'Imposta 1 kg totale, 2,8% di sale e 0,5% di olio.', { useTotalWeight: true, totalDoughWeight: 1000, saltPct: 2.8, oilPct: 0.5 }),
    item('flour-01', 'catalogue', `Usa il 30% di ${nuvolaPrompt}.`, { flourBlend: blendWithBaseline(caputoNuvola, 30) }),
    item('flour-02', 'catalogue', `Aggiungi il 40% di ${pizzeriaPrompt}.`, { flourBlend: blendWithBaseline(caputoPizzeria, 40) }),
    item('flour-03', 'catalogue', `Per la miscela usa metà ${nuvolaPrompt}.`, { flourBlend: blendWithBaseline(caputoNuvola, 50) }),
    item('flour-04', 'catalogue', 'Usa Caputo.', {}, { expectAmbiguity: true }),
    item('flour-05', 'catalogue', 'Metti il 30% di Caputo.', {}, { expectAmbiguity: true }),
    item('flour-06', 'catalogue', 'Usa il 25% di Molino Che Non Esiste.', {}, { expectUnsupported: true }),
    item('flour-07', 'catalogue', 'Usa le farine che ho in dispensa.', {}, { expectAmbiguity: true, expectedPantryOnly: true }),
    item('flour-08', 'catalogue', 'Completa la miscela con una farina qualsiasi.', {}, { expectAmbiguity: true }),
    item('flour-09', 'catalogue', 'Usa solo farine presenti in dispensa.', {}, { expectAmbiguity: true, expectedPantryOnly: true }),
    item('flour-10', 'catalogue', 'Senza vincolo dispensa, scegli una farina del catalogo.', {}, { expectedPantryOnly: false }),
    item('yeast-01', 'yeast', 'Usa 2 grammi di lievito fresco.', { yeastType: 'fresh', yeastPct: 0.347 }),
    item('yeast-02', 'yeast', 'Metti un grammo di lievito secco attivo.', { yeastType: 'active-dry', yeastPct: 0.173 }),
    item('yeast-03', 'yeast', 'Aggiungi 0,5 g di lievito secco istantaneo.', { yeastType: 'instant-dry', yeastPct: 0.087 }),
    item('yeast-04', 'yeast', 'Usa 3 grammi di lievito di birra fresco.', { yeastType: 'fresh', yeastPct: 0.52 }),
    item('yeast-05', 'yeast', 'Metti lo 0,2% di lievito fresco.', { yeastPct: 0.2, yeastType: 'fresh' }),
    item('yeast-06', 'yeast', 'Imposta lo 0,1 per cento di lievito secco attivo.', { yeastPct: 0.1, yeastType: 'active-dry' }),
    item('yeast-07', 'yeast', 'Vorrei il 0,08% di lievito secco istantaneo.', { yeastPct: 0.08, yeastType: 'instant-dry' }),
    item('yeast-08', 'yeast', 'Poco lievito, circa mezzo grammo.', {}, { expectAmbiguity: true }),
    item('ferment-01', 'fermentation', 'Fermentazione di 24 ore in frigorifero a 4 gradi.', { fermentation: { totalDurationMinutes: 1440, strategy: 'refrigerated', refrigeratorTemperatureC: 4 } }),
    item('ferment-02', 'fermentation', 'Fai 48 ore in frigo a 5 °C.', { fermentation: { totalDurationMinutes: 2880, strategy: 'refrigerated', refrigeratorTemperatureC: 5 } }),
    item('ferment-03', 'fermentation', 'Lievitazione a temperatura ambiente per 8 ore.', { fermentation: { totalDurationMinutes: 480, strategy: 'room-temperature' } }),
    item('ferment-04', 'fermentation', 'Prova una fermentazione combinata di 12 ore.', { fermentation: { totalDurationMinutes: 720, strategy: 'combined' } }),
    item('ferment-05', 'fermentation', 'Lascia maturare per 36 ore in frigorifero.', { fermentation: { totalDurationMinutes: 2160, strategy: 'refrigerated' } }),
    item('ferment-06', 'fermentation', 'Fai lievitare per 90 minuti a temperatura ambiente.', { fermentation: { totalDurationMinutes: 90, strategy: 'room-temperature' } }),
    item('ferment-07', 'fermentation', 'Temperatura del frigo a 6 gradi.', { fermentation: { refrigeratorTemperatureC: 6 } }),
    item('ferment-08', 'fermentation', 'Tieni l’impasto a 22 gradi.', { fermentation: { ambientTemperatureC: 22 } }),
    item('ferment-09', 'fermentation', 'La temperatura dell’impasto misurata è 24 °C.', { fermentation: { measuredDoughTemperatureC: 24 } }),
    item('ferment-10', 'fermentation', 'Una lievitazione di 2 giorni in frigo.', { fermentation: { totalDurationMinutes: 2880, strategy: 'refrigerated' } }),
    item('dates-01', 'dates', 'Cuoci domani alle 20:30.', { fermentation: { bakingAt: '2026-10-25T19:30:00.000Z' } }),
    item('dates-02', 'dates', 'Sposta la cottura a dopodomani alle 21.', { fermentation: { bakingAt: '2026-10-26T20:00:00.000Z' } }),
    item('dates-03', 'dates', 'Cuoci domenica alle 21.', { fermentation: { bakingAt: '2026-10-25T20:00:00.000Z' } }),
    item('dates-04', 'dates', 'La pizza deve essere pronta il 26/10/2026 alle 19.', { fermentation: { bakingAt: '2026-10-26T18:00:00.000Z' } }),
    item('dates-05', 'dates', 'Programma la cottura per il 25 ottobre 2026 alle 18:15.', { fermentation: { bakingAt: '2026-10-25T17:15:00.000Z' } }),
    item('dates-06', 'dates', 'Domani sera alle 20, forno acceso.', { fermentation: { bakingAt: '2026-10-25T19:00:00.000Z' } }),
    item('dates-07', 'dates', 'Cuoci il 29/03/2026 alle 2:30.', {}, { expectAmbiguity: true }),
    item('dates-08', 'dates', 'Cuoci il 25/10/2026 alle 2:30.', {}, { expectAmbiguity: true }),
    item('availability-01', 'availability', 'Non posso fare lo staglio tra le 23 e le 8.', { fermentation: { availability: { avoidRestHours: true, unavailableStart: '23:00', unavailableEnd: '08:00' } } }),
    item('availability-02', 'availability', 'Evita le operazioni dalle 22:30 alle 7:30.', { fermentation: { availability: { avoidRestHours: true, unavailableStart: '22:30', unavailableEnd: '07:30' } } }),
    item('availability-03', 'availability', 'Sono fuori casa dalle 9 alle 17, non pianificare lavorazioni.', { fermentation: { availability: { avoidRestHours: true, unavailableStart: '09:00', unavailableEnd: '17:00' } } }),
    item('availability-04', 'availability', 'Non ci sono fasce orarie da evitare.', { fermentation: { availability: { avoidRestHours: false, unavailableStart: '23:00', unavailableEnd: '08:00' } } }),
    item('availability-05', 'availability', 'Lo staglio non deve cadere tra mezzanotte e le sette.', { fermentation: { availability: { avoidRestHours: true, unavailableStart: '00:00', unavailableEnd: '07:00' } } }),
    item('contradiction-01', 'ambiguity', 'Idratazione al 65% e idratazione al 75%.', {}, { expectAmbiguity: true }),
    item('contradiction-02', 'ambiguity', 'Fai 6 panetti ma anche 8 panetti.', {}, { expectAmbiguity: true }),
    item('contradiction-03', 'ambiguity', 'Cuoci domani alle 19 e domani alle 21.', {}, { expectAmbiguity: true }),
    item('contradiction-04', 'ambiguity', 'Metti il 2% di sale, anzi il 4%.', {}, { expectAmbiguity: true }),
    item('contradiction-05', 'ambiguity', 'Fermentazione refrigerata a temperatura ambiente per 24 ore.', {}, { expectAmbiguity: true }),
    item('missing-01', 'ambiguity', 'Vorrei una pizza molto idratata.', {}, { expectAmbiguity: true }),
    item('missing-02', 'ambiguity', 'Fammi una dose piccola.', {}, { expectAmbiguity: true }),
    item('missing-03', 'ambiguity', 'Metti poco lievito.', {}, { expectAmbiguity: true }),
    item('missing-04', 'ambiguity', 'Usa una farina forte.', {}, { expectAmbiguity: true }),
    item('missing-05', 'ambiguity', 'Cuoci domani.', {}, { expectAmbiguity: true }),
    item('invalid-01', 'invalid', 'Idratazione al 400%.', { hydrationPct: 400 }, { expectInvalid: true }),
    item('invalid-02', 'invalid', 'Idratazione al -5%.', { hydrationPct: -5 }, { expectInvalid: true }),
    item('invalid-03', 'invalid', 'Prepara 0 panetti.', { ballCount: 0 }, { expectInvalid: true }),
    item('invalid-04', 'invalid', 'Metti il sale al 101%.', { saltPct: 101 }, { expectInvalid: true }),
    item('ferment-11', 'fermentation', 'Fai una fermentazione combinata di 1 ora.', { fermentation: { totalDurationMinutes: 60, strategy: 'combined' } }),
    item('unsupported-01', 'unsupported', 'Dimmi se la pizza sarà soffice e profumata.', {}, { expectUnsupported: true }),
    item('unsupported-02', 'unsupported', 'Quante calorie avrà ogni fetta?', {}, { expectUnsupported: true }),
    item('unsupported-03', 'unsupported', 'Consigliami una canzone mentre impasto.', {}, { expectUnsupported: true }),
    item('unsupported-04', 'unsupported', 'Prevedi il gusto della pizza.', {}, { expectUnsupported: true }),
    item('unsupported-05', 'unsupported', 'Ordina la farina online per me.', {}, { expectUnsupported: true }),
    item('colloquial-01', 'colloquial', 'Dai, fammene sei palline da 250.', { ballCount: 6, ballWeight: 250 }),
    item('colloquial-02', 'colloquial', 'Alza un filo l’acqua: fai 70%.', { hydrationPct: 70 }),
    item('colloquial-03', 'colloquial', 'Mettici un goccino d’olio, tipo 2%.', { oilPct: 2 }),
    item('colloquial-04', 'colloquial', 'Facciamo una notte in frigo, 12 ore.', { fermentation: { totalDurationMinutes: 720, strategy: 'refrigerated' } }),
    item('colloquial-05', 'colloquial', 'Buttaci dentro il 2,5% di sale.', { saltPct: 2.5 }),
    item('colloquial-06', 'colloquial', 'Per domani sera alle otto e mezza.', { fermentation: { bakingAt: '2026-10-25T19:30:00.000Z' } }),
    item('followup-01', 'follow-up', 'Aumenta l’idratazione al 70%.', { hydrationPct: 70 }),
    item('followup-02', 'follow-up', 'Anzi portala al 72%.', {}, { expectAmbiguity: true }),
    item('followup-03', 'follow-up', 'Togli il vincolo della dispensa.', {}, { expectAmbiguity: true }),
    item('followup-04', 'follow-up', 'Lascia tutto il resto com’è e cambia il sale al 2,8%.', { saltPct: 2.8 }),
    item('followup-05', 'follow-up', 'No, facciamo 5 panetti invece di 6.', { ballCount: 5 }),
  ]
}

export function getBenchmarkBaselineFlour(flours: Flour[], excludedIds: Array<string | undefined> = []): Flour | undefined {
  const excluded = new Set(excludedIds.filter((id): id is string => Boolean(id)))
  return flours.find((flour) => isFlourBlendEligible(flour) && !excluded.has(flour.id)) ?? flours.find(isFlourBlendEligible)
}

export function getBenchmarkTargetFlourIds(flours: Flour[]): string[] {
  return flours
    .filter(({ brand, name }) => /caputo/i.test(brand) && /(?:nuvola|pizzeria)/i.test(name))
    .map(({ id }) => id)
}