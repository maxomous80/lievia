import { Clock3, CookingPot, Hand, Snowflake, Thermometer } from 'lucide-react'
import { isSameDay } from 'date-fns'
import { environmentLabel, formatDuration, formatItalianDateTime, PHASE_LABELS } from '../domain/fermentation/schedule'
import type { FermentationConfig, FermentationPhase, FermentationPhaseType } from '../domain/fermentation/types'

const handsOnPhases = new Set<FermentationPhaseType>(['mixing', 'folding', 'dividing'])

function PhaseIcon({ phase }: { phase: FermentationPhase }) {
  if (phase.type === 'baking') return <CookingPot size={13} />
  if (phase.environment === 'refrigerator') return <Snowflake size={13} />
  if (handsOnPhases.has(phase.type)) return <Hand size={13} />
  return <Clock3 size={13} />
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
  const phases = [...config.phases, bakeEvent]
  return (
    <ol className={`fermentation-timeline${compact ? ' compact' : ''}`}>
      {phases.map((phase, index) => {
        const handsOn = handsOnPhases.has(phase.type)
        const isBake = phase.type === 'baking'
        return <li className={`timeline-phase${handsOn ? ' hands-on' : ''}${isBake ? ' bake-event' : ''}`} key={`${phase.id}-${index}`}>
          <span className="timeline-marker"><PhaseIcon phase={phase} /></span>
          <div className="timeline-content">
            <div className="timeline-phase-heading"><strong>{PHASE_LABELS[phase.type]}</strong>{handsOn && <span className="timeline-kind">OPERAZIONE</span>}</div>
            <div className="timeline-meta"><span>{formatItalianDateTime(phase.startAt)}{!isBake && ` – ${formatItalianDateTime(phase.endAt, !isSameDay(new Date(phase.startAt), new Date(phase.endAt)))}`}</span>{!isBake && <span>{formatDuration(phase.durationMinutes)}</span>}</div>
            {!compact && <div className="timeline-temperature"><Thermometer size={11} />{isBake ? 'Forno' : `${environmentLabel(phase.environment)} · ${phase.temperatureC} °C`}</div>}
            {!compact && phase.notes && <p className="timeline-note">{phase.notes}</p>}
          </div>
        </li>
      })}
    </ol>
  )
}