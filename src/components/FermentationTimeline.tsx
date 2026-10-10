import { Clock3, CookingPot, Hand, Snowflake, Thermometer } from 'lucide-react'
import { isSameDay } from 'date-fns'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { environmentLabel, formatDuration, PHASE_LABELS } from '../domain/fermentation/schedule'
import type { FermentationConfig, FermentationPhase, FermentationPhaseType } from '../domain/fermentation/types'
import { isSkippedOptionalPhase } from '../domain/fermentation/validation'

const handsOnPhases = new Set<FermentationPhaseType>(['mixing', 'folding', 'dividing'])

function PhaseIcon({ phase }: { phase: FermentationPhase }) {
  if (phase.type === 'baking') return <CookingPot size={18} />
  if (phase.environment === 'refrigerator') return <Snowflake size={18} />
  if (handsOnPhases.has(phase.type)) return <Hand size={18} />
  return <Clock3 size={18} />
}

function phaseKind(phase: FermentationPhase) {
  if (phase.type === 'baking') return 'Cottura'
  if (handsOnPhases.has(phase.type)) return 'Operazione manuale'
  return phase.environment === 'refrigerator' ? 'Frigorifero' : 'Ambiente'
}

function formatPhaseDate(value: string) {
  const date = new Date(value)
  const formatted = format(date, 'EEEE d MMMM', { locale: it })
  return formatted.charAt(0).toLocaleUpperCase('it') + formatted.slice(1)
}

export function FermentationTimeline({ config, compact = false }: { config: FermentationConfig; compact?: boolean }) {
  const bakeEvent: FermentationPhase = {
    id: 'evento-cottura',
    type: 'baking',
    durationMinutes: 0,
    startAt: config.bakingAt,
    endAt: config.bakingAt,
    environment: 'custom',
    temperatureC: 0,
    notes: 'Inizio cottura previsto',
  }
  const phases = [...config.phases.filter((phase) => !isSkippedOptionalPhase(phase)), bakeEvent]
  return (
    <ol className={`fermentation-timeline${compact ? ' compact' : ''}`}>
      {phases.map((phase, index) => {
        const handsOn = handsOnPhases.has(phase.type)
        const isBake = phase.type === 'baking'
        return <li className={`timeline-phase${handsOn ? ' hands-on' : ''}${isBake ? ' bake-event' : ''}`} key={`${phase.id}-${index}`}>
          <span className="timeline-marker"><PhaseIcon phase={phase} /></span>
          <div className="timeline-content">
            <div className="timeline-phase-heading"><strong>{PHASE_LABELS[phase.type]}</strong><span className="timeline-kind">{phaseKind(phase)}</span></div>
            <div className="timeline-dates"><time dateTime={phase.startAt}>{formatPhaseDate(phase.startAt)}</time>{!isBake && !isSameDay(new Date(phase.startAt), new Date(phase.endAt)) && <time dateTime={phase.endAt}>{formatPhaseDate(phase.endAt)}</time>}</div>
            <div className="timeline-times"><time dateTime={phase.startAt}>{format(new Date(phase.startAt), 'HH:mm')}</time>{!isBake && <><span aria-label="fino a">→</span><time dateTime={phase.endAt}>{format(new Date(phase.endAt), 'HH:mm')}</time></>}</div>
            {!isBake && <div className="timeline-duration">Durata: <strong>{formatDuration(phase.durationMinutes)}</strong></div>}
            {!compact && <div className="timeline-temperature"><Thermometer size={15} />{isBake ? 'Forno' : `${environmentLabel(phase.environment)} · ${phase.temperatureC} °C`}</div>}
            {!compact && phase.notes && <p className="timeline-note">{phase.notes}</p>}
          </div>
        </li>
      })}
    </ol>
  )
}