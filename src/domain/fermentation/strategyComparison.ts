import { getFlourGuidance, getTemperatureGuidance } from './guidance'
import { optimizeFermentationSchedule } from './availability'
import { applyStrategyTemplate, formatDuration } from './schedule'
import { calculateTemperatureProfile, type ThermalModelParameters, type TemperatureProfile } from './temperatureProfile'
import type { FermentationConfig, FermentationStrategy, FlourGuidanceInput } from './types'

export type ComparableStrategy = Exclude<FermentationStrategy, 'custom'>

export interface StrategyComparisonItem {
  strategy: ComparableStrategy
  config: FermentationConfig | null
  totalPreparationMinutes: number
  roomTemperatureMinutes: number
  refrigeratorMinutes: number
  temperatureProfile: TemperatureProfile | null
  practicalOperations: string[]
  timingRequirement: string
  warnings: string[]
  modelSupportedExposureMinutes: null
}

const strategies: ComparableStrategy[] = ['room-temperature', 'refrigerated', 'combined']

export function compareFermentationStrategies(
  config: FermentationConfig,
  thermalParameters: ThermalModelParameters = {},
  flourGuidance?: FlourGuidanceInput,
): StrategyComparisonItem[] {
  return strategies.map((strategy) => {
    try {
      const template = applyStrategyTemplate(config, strategy)
      const optimized = optimizeFermentationSchedule(template)
      if (!optimized.ok || !optimized.config) throw new RangeError(optimized.conflicts.join(' '))
      const candidate = optimized.config
      const roomTemperatureMinutes = candidate.phases
        .filter((phase) => phase.environment === 'ambient')
        .reduce((total, phase) => total + phase.durationMinutes, 0)
      const refrigeratorMinutes = candidate.phases
        .filter((phase) => phase.environment === 'refrigerator')
        .reduce((total, phase) => total + phase.durationMinutes, 0)
      const warnings = [
        ...getTemperatureGuidance(candidate),
        ...(flourGuidance ? getFlourGuidance({ ...flourGuidance, durationMinutes: candidate.totalDurationMinutes }) : []),
      ].map(({ message }) => message)

      return {
        strategy,
        config: candidate,
        totalPreparationMinutes: candidate.totalDurationMinutes,
        roomTemperatureMinutes,
        refrigeratorMinutes,
        temperatureProfile: calculateTemperatureProfile(candidate, thermalParameters),
        practicalOperations: candidate.phases.filter((phase) =>
          phase.type === 'mixing' || phase.type === 'folding' || phase.type === 'dividing',
        ).map((phase) => phase.notes),
        timingRequirement: `Programma ${formatDuration(candidate.totalDurationMinutes)} fino alla cottura prevista.`,
        warnings,
        modelSupportedExposureMinutes: null,
      }
    } catch (error) {
      return {
        strategy,
        config: null,
        totalPreparationMinutes: config.totalDurationMinutes,
        roomTemperatureMinutes: 0,
        refrigeratorMinutes: 0,
        temperatureProfile: null,
        practicalOperations: [],
        timingRequirement: 'La finestra impostata non consente di distribuire le operazioni del modello.',
        warnings: [error instanceof Error ? error.message : 'Strategia non disponibile per la durata impostata.'],
        modelSupportedExposureMinutes: null,
      }
    }
  })
}