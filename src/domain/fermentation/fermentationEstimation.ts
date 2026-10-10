import type { FermentationConfig } from './types'
import type { YeastType } from '../../models'
import { calculateTemperatureProfile, type ThermalModelParameters, type TemperatureProfile } from './temperatureProfile'

export interface FermentationExposureEstimate {
  available: false
  exposureMinutes: null
  yeastInput?: { type: YeastType; percentageOnFlour: number }
  temperatureProfile: TemperatureProfile
  message: string
}

export function estimateFermentationExposure(
  config: FermentationConfig,
  thermalParameters: ThermalModelParameters = {},
  yeastInput?: { type: YeastType; percentageOnFlour: number },
): FermentationExposureEstimate {
  let temperatureProfile: TemperatureProfile
  try {
    temperatureProfile = calculateTemperatureProfile(config, thermalParameters)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    temperatureProfile = {
      status: 'insufficient-data',
      points: [],
      explanation: `Profilo termico non stimato: ${error.message}`,
    }
  }
  return {
    available: false,
    exposureMinutes: null,
    yeastInput,
    temperatureProfile,
    message: 'Esposizione biologica non calcolata: tipo e percentuale di lievito sono registrati come input, ma manca un modello cinetico documentato e calibrato per questo impasto.',
  }
}