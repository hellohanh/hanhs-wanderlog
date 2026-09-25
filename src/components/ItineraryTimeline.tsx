// Shared timeline/card/pool components (Session 32/33) — extracted
// from ItineraryView.tsx so the full Itinerary tab and the read/write
// itinerary panel on the map page (MapView.tsx) render and behave
// identically, rather than two implementations that could drift apart
// visually or functionally. Both consumers bring their own DndContext
// (dnd-kit doesn't require a single global one) and their own
// mutation functions (insert/update/delete against itinerary_stops) —
// this file only holds the presentational + drag-source/drop-target
// pieces, not the Supabase writes themselves.
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { groupPinsByCategory, pinBadgeColor } from '../lib/pinCategories'
import {
  blockPositionStyle,
  carrierLogoPath,
  continuationBlockGeometry,
  formatDayDate,
  formatLocationLabel,
  legBlockGeometry,
  legDayOffset,
  legDurationParts,
  minutesToLabel,
  stopBlockGeometry,
  timezoneAbbreviation,
  HOUR_PX,
  LEG_DIVIDER_ICONS,
  LEG_MODE_CONFIG,
  MIN_LEG_CARD_PX,
  EDIT_ICON,
  type ColumnLayout
} from '../lib/itineraryLayout'
import type { Pin, ItineraryStop, TravelLeg } from '../types'
import styles from './ItineraryTimeline.module.css'

export type StopWithPin = ItineraryStop & { pin: Pin }

// Hover-detail popups (Session 43) — every timeline block, stop or
// leg, shows a small detail card on hover, regardless of whether the
// block itself is too compressed to show its own full text. Rendered
// via a portal to document.body rather than as a normal positioned
// child, because the timeline sits inside a scrolling/clipped
// container (.timelineScroll or .timelineWrapper's overflow: hidden)
// — a plain CSS-anchored popup would be invisibly clipped the moment
// it tried to extend past that boundary. Position is computed from
// the hovered block's real getBoundingClientRect() on mouseenter, so
// it's correct regardless of which page/panel width hosts it; flips
// to the block's left side automatically if there isn't room on the
// right (common in the narrow map-page panel).
function useBlockHoverPopup<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [style, setStyle] = useState<React.CSSProperties | null>(null)
  const popupWidth = 220

  function handleMouseEnter() {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const flipLeft = rect.right + 8 + popupWidth > window.innerWidth
    setStyle({
      position: 'fixed',
      top: rect.top,
      ...(flipLeft ? { right: window.innerWidth - rect.left + 8 } : { left: rect.right + 8 }),
      width: popupWidth
    })
  }
  function handleMouseLeave() {
    setStyle(null)
  }

  return { ref, style, handleMouseEnter, handleMouseLeave }
}

function HoverPopupPortal({ style, children }: { style: React.CSSProperties | null; children: React.ReactNode }) {
  if (!style) return null
  return createPortal(
    <div className={styles.blockHoverPopup} style={style}>
      {children}
    </div>,
    document.body
  )
}

// Shared between the card list (TravelCardFull) and the timeline
// blocks (TimelineLegBlock/TimelineContinuationBlock) — the actual
// content, factored out once rather than kept in sync by hand in
// three places. `showDeparture=false` is only for a continuation
// block, which has no departure side to show (that's on its actual
// departure day).
export function TravelCardContent({ leg, showDeparture = true }: { leg: TravelLeg; showDeparture?: boolean }) {
  const cfg = LEG_MODE_CONFIG[leg.mode]
  const duration = legDurationParts(leg)
  const dayOffset = legDayOffset(leg)

  return (
    <>
      <div className={styles.travelCardDuration}>
        {duration ? (
          <>
            <span className={styles.travelCardDurationHours}>
              {duration.hours > 0 ? `${duration.hours}h` : `${duration.minutes}m`}
            </span>
            {duration.hours > 0 && (
              <span className={styles.travelCardDurationMin}>{duration.minutes} MIN</span>
            )}
          </>
        ) : (
          <span className={styles.travelCardDurationHours}>—</span>
        )}
      </div>

      <div className={styles.travelCardMain}>
        <p className={styles.travelCardRoute}>
          {leg.title || `${leg.from_location} to ${leg.to_location}`}
        </p>
        <div className={styles.travelCardMeta}>
          <CarrierBadge mode={leg.mode} carrier={leg.carrier} size={20} />
          <span>
            {leg.carrier || cfg.label}
            {leg.reference ? ` · ${leg.reference}` : ''}
          </span>
        </div>
        {((showDeparture && leg.from_time) || leg.to_time) && (
          <div className={styles.travelCardTimes}>
            {showDeparture && (
              <div className={styles.travelCardEndpoint}>
                <span className={styles.travelCardLocation}>{formatLocationLabel(leg.from_location)}</span>
                <span className={styles.travelCardTimeValue}>{leg.from_time?.slice(0, 5)}</span>
                {leg.from_timezone && leg.from_date && leg.from_time && (
                  <span className={styles.travelCardTz}>
                    {timezoneAbbreviation(leg.from_timezone, leg.from_date, leg.from_time)}
                  </span>
                )}
              </div>
            )}

            {leg.to_time && (
              <>
                {showDeparture && (
                  <div className={styles.travelCardDivider}>
                    {leg.mode === 'flight' ? (
                      <>
                        <span className={styles.travelCardDividerDots}>•••••</span>
                        <span className={styles.travelCardDividerPlane}>{'\u2708\uFE0E'}</span>
                        <span className={styles.travelCardDividerDots}>•••••</span>
                      </>
                    ) : (
                      <>
                        <span className={styles.travelCardDividerDots}>•••••</span>
                        <span
                          className={styles.travelCardDividerIcon}
                          style={{ color: cfg.color }}
                          dangerouslySetInnerHTML={{ __html: LEG_DIVIDER_ICONS[leg.mode] }}
                        />
                        <span className={styles.travelCardDividerDots}>•••••</span>
                      </>
                    )}
                  </div>
                )}

                <div className={styles.travelCardEndpoint}>
                  <span className={styles.travelCardLocation}>{formatLocationLabel(leg.to_location)}</span>
                  <span className={styles.travelCardTimeValue}>{leg.to_time.slice(0, 5)}</span>
                  {leg.to_timezone && leg.to_date && (
                    <span className={styles.travelCardTz}>
                      {timezoneAbbreviation(leg.to_timezone, leg.to_date, leg.to_time)}
                    </span>
                  )}
                  {dayOffset && <span className={styles.travelCardDayOffset}>+{dayOffset}</span>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export function TravelCardFull({ leg, onEdit }: { leg: TravelLeg; onEdit: () => void }) {
  return (
    <div className={styles.travelCardFull}>
      <TravelCardContent leg={leg} />
      <button
        type="button"
        className={styles.travelCardEditButton}
        title="edit"
        aria-label="edit travel leg"
        onClick={onEdit}
        dangerouslySetInnerHTML={{ __html: EDIT_ICON }}
      />
    </div>
  )
}

// Session 43 — hover-popup content for a leg block. Deliberately
// shows the title ALONGSIDE the route/carrier/time detail, unlike
// TravelCardContent's own main-card rendering where a set title
// REPLACES the route line — the user asked for both together here,
// since the hover popup's whole purpose is showing everything at
// once regardless of how the block itself is condensed.
function LegHoverContent({ leg, cfg }: { leg: TravelLeg; cfg: (typeof LEG_MODE_CONFIG)[TravelLeg['mode']] }) {
  return (
    <>
      {leg.title && <p className={styles.blockHoverPopupTitle}>{leg.title}</p>}
      <p className={leg.title ? styles.blockHoverPopupLine : styles.blockHoverPopupTitle}>
        {formatLocationLabel(leg.from_location)} → {formatLocationLabel(leg.to_location)}
      </p>
      <p className={styles.blockHoverPopupLine}>
        {leg.carrier || cfg.label}
        {leg.reference ? ` · ${leg.reference}` : ''}
      </p>
      {(leg.from_time || leg.to_time) && (
        <p className={styles.blockHoverPopupLine}>
          {leg.from_time?.slice(0, 5) ?? ''}
          {leg.from_timezone && leg.from_date && leg.from_time
            ? ` ${timezoneAbbreviation(leg.from_timezone, leg.from_date, leg.from_time)}`
            : ''}
          {leg.to_time ? ` → ${leg.to_time.slice(0, 5)}` : ''}
          {leg.to_timezone && leg.to_date && leg.to_time
            ? ` ${timezoneAbbreviation(leg.to_timezone, leg.to_date, leg.to_time)}`
            : ''}
        </p>
      )}
    </>
  )
}

export function CarrierBadge({ mode, carrier, size = 22 }: { mode: TravelLeg['mode']; carrier: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  const cfg = LEG_MODE_CONFIG[mode]

  if (carrier && !failed) {
    return (
      <img
        key={carrier}
        src={carrierLogoPath(carrier)}
        alt={carrier}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'contain', flexShrink: 0 }}
      />
    )
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: cfg.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: cfg.svg }} />
    </span>
  )
}

export function PoolZone({ pins, onQuickAdd }: { pins: Pin[]; onQuickAdd: (pinId: string) => void }) {
  const { setNodeRef } = useDroppable({ id: 'pool-zone' })
  const groups = groupPinsByCategory(pins)

  return (
    <div className={styles.poolSection}>
      <p className={styles.poolLabel}>pinned · drag onto the timeline, or tap +</p>
      <div ref={setNodeRef} className={styles.poolGroups}>
        {pins.length === 0 && <p className={styles.hint}>everything's scheduled, or no pins yet.</p>}
        {groups.map(group => (
          <div key={group.key} className={styles.poolGroup}>
            <p className={styles.poolGroupLabel}>{group.label}</p>
            <div className={styles.poolList}>
              {group.pins.map(pin => (
                <PoolChip key={pin.id} pin={pin} onQuickAdd={onQuickAdd} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PoolChip({ pin, onQuickAdd }: { pin: Pin; onQuickAdd: (pinId: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `pool-${pin.id}` })
  const badgeColor = pinBadgeColor(pin.category, pin.icon)

  return (
    <div
      ref={setNodeRef}
      className={styles.poolChip}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      {...listeners}
      {...attributes}
    >
      <span className={styles.poolChipDot} style={{ backgroundColor: badgeColor }} />
      <span>{pin.name}</span>
      <button
        type="button"
        className={styles.quickAddButton}
        title="add to this day"
        aria-label="add to this day"
        onClick={e => {
          e.stopPropagation()
          onQuickAdd(pin.id)
        }}
      >
        +
      </button>
    </div>
  )
}

export function TimelineStopBlock({
  stop,
  onClick,
  layout,
  gutter
}: {
  stop: StopWithPin
  onClick: () => void
  layout?: ColumnLayout
  gutter?: number
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tstop-${stop.id}` })
  const badgeColor = pinBadgeColor(stop.pin.category, stop.pin.icon)
  const { top, height } = stopBlockGeometry(stop)
  const hover = useBlockHoverPopup<HTMLDivElement>()

  return (
    <div
      ref={node => {
        setNodeRef(node)
        ;(hover.ref as React.MutableRefObject<HTMLDivElement | null>).current = node
      }}
      className={styles.timelineBlock}
      style={{ top, height, backgroundColor: badgeColor, opacity: isDragging ? 0.4 : 1, ...blockPositionStyle(layout, gutter) }}
      onClick={onClick}
      onMouseEnter={hover.handleMouseEnter}
      onMouseLeave={hover.handleMouseLeave}
      {...listeners}
      {...attributes}
    >
      <div className={styles.timelineBlockHeader}>
        <span className={styles.timelineBlockName}>{stop.pin.name}</span>
        <span className={styles.timelineBlockTime}>
          {stop.start_time?.slice(0, 5)}
          {stop.end_time ? `–${stop.end_time.slice(0, 5)}` : ''}
        </span>
      </div>
      {/* stop.notes: a note about this specific VISIT (itinerary_stops.notes,
          migration 012) — not the pin, so the same place scheduled on two
          different days can carry two different notes. */}
      {stop.notes && <p className={styles.timelineBlockNote}>{stop.notes}</p>}
      <HoverPopupPortal style={hover.style}>
        <p className={styles.blockHoverPopupTitle}>{stop.pin.name}</p>
        <p className={styles.blockHoverPopupLine}>
          {stop.start_time?.slice(0, 5)}
          {stop.end_time ? `–${stop.end_time.slice(0, 5)}` : ''}
        </p>
        {stop.notes && <p className={styles.blockHoverPopupLine}>{stop.notes}</p>}
      </HoverPopupPortal>
    </div>
  )
}

export function TimelineLegBlock({
  leg,
  onClick,
  layout,
  gutter
}: {
  leg: TravelLeg
  onClick: () => void
  layout?: ColumnLayout
  gutter?: number
}) {
  const cfg = LEG_MODE_CONFIG[leg.mode]
  const hover = useBlockHoverPopup<HTMLDivElement>()

  // Positioned by literal local-clock readings (Option B, confirmed
  // with the user) rather than real elapsed duration — this is what
  // makes back-to-back legs through the same city (e.g. arrive LAX,
  // depart LAX) line up correctly on the shared axis, since both
  // readings are in that city's clock. "Crosses midnight" clips the
  // block at the bottom of today's track with a "continues" indicator.
  const { top, height: geometryHeight, crossesMidnight } = legBlockGeometry(leg)
  const height = Math.max(geometryHeight, MIN_LEG_CARD_PX)

  // Not draggable, on purpose — a flight's position encodes real
  // date/time/timezone data, so an accidental drag could silently
  // corrupt that in a way a dragged pin stop never could. Moving a
  // leg only happens through an intentional edit.
  return (
    <div
      ref={hover.ref}
      className={styles.timelineLegCard}
      style={{
        top,
        height,
        borderLeftColor: cfg.color,
        cursor: 'pointer',
        touchAction: 'pan-y',
        ...blockPositionStyle(layout, gutter)
      }}
      onClick={onClick}
      onMouseEnter={hover.handleMouseEnter}
      onMouseLeave={hover.handleMouseLeave}
    >
      <TravelCardContent leg={leg} />
      {crossesMidnight && <span className={styles.timelineBlockContinues}>continues next day →</span>}
      <HoverPopupPortal style={hover.style}>
        <LegHoverContent leg={leg} cfg={cfg} />
      </HoverPopupPortal>
    </div>
  )
}

// The tail end of a leg that departed on an EARLIER day and lands on
// this one — from_date/to_date (real dates, not a guess) are what
// identify this, computed by the caller as `continuationLegs`. Always
// starts at the top of the day (00:00); not draggable.
export function TimelineContinuationBlock({
  leg,
  onClick,
  layout,
  gutter
}: {
  leg: TravelLeg
  onClick: () => void
  layout?: ColumnLayout
  gutter?: number
}) {
  const cfg = LEG_MODE_CONFIG[leg.mode]
  const hover = useBlockHoverPopup<HTMLDivElement>()
  const { top, height: geometryHeight } = continuationBlockGeometry(leg)
  // +30 to account for the extra top padding (.timelineContinuationCard)
  // that makes room for the "continued from" label.
  const height = Math.max(geometryHeight, MIN_LEG_CARD_PX + 30)

  return (
    <div
      ref={hover.ref}
      className={`${styles.timelineLegCard} ${styles.timelineContinuationCard}`}
      style={{ top, height, borderLeftColor: cfg.color, cursor: 'pointer', touchAction: 'pan-y', ...blockPositionStyle(layout, gutter) }}
      onClick={onClick}
      onMouseEnter={hover.handleMouseEnter}
      onMouseLeave={hover.handleMouseLeave}
    >
      <TravelCardContent leg={leg} showDeparture={false} />
      <span className={styles.timelineBlockContinuedFrom}>
        ← continued from {leg.from_date ? formatDayDate(leg.from_date) : 'yesterday'}
      </span>
      <HoverPopupPortal style={hover.style}>
        <LegHoverContent leg={leg} cfg={cfg} />
      </HoverPopupPortal>
    </div>
  )
}

export interface TimelineZoneProps {
  timedStops: StopWithPin[]
  stopColumnLayout: Map<string, ColumnLayout>
  timedLegs: TravelLeg[]
  continuationLegs: TravelLeg[]
  legColumnLayout: Map<string, ColumnLayout>
  onStopClick: (stop: StopWithPin) => void
  onLegClick: (leg: TravelLeg) => void
  // Narrower hosts (the 300px map-page panel) pass a smaller gutter
  // than the full Itinerary tab's default 60px hour-label column.
  gutter?: number
}

// forwardRef isn't used elsewhere in this codebase's style, so this
// takes the scroll/droppable ref as a prop instead of introducing it
// for one component.
export function TimelineZone({
  timedStops,
  stopColumnLayout,
  timedLegs,
  continuationLegs,
  legColumnLayout,
  onStopClick,
  onLegClick,
  scrollRef,
  gutter,
  className,
  uncapped
}: TimelineZoneProps & { scrollRef: React.RefObject<HTMLDivElement>; className?: string; uncapped?: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'timeline-zone' })

  function combinedRef(node: HTMLDivElement | null) {
    setNodeRef(node)
    ;(scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node
  }

  const hours = Array.from({ length: 24 }, (_, i) => i)

  // `uncapped` (Session 40) drops .timelineScroll's own max-height/
  // overflow-y — needed wherever an OUTER ancestor is already the
  // single scrollable region for the whole panel (the map page, since
  // Session 39's .itineraryPanel fix). Without this, this inner box
  // still independently caps at 1080px and scrolls the remaining
  // hours itself, stacking a SECOND scrollbar on top of the outer
  // one — confusing, and not what "one scroll region" was meant to
  // achieve. The Itinerary tab doesn't pass this — its own page
  // doesn't scroll, so this box being the one thing that scrolls is
  // exactly the intended design there.
  return (
    <div className={className ? `${styles.timelineWrapper} ${className}` : styles.timelineWrapper}>
      <div ref={combinedRef} className={uncapped ? styles.timelineScrollUncapped : styles.timelineScroll}>
        <div className={styles.timelineTrack} style={{ height: 24 * HOUR_PX }}>
          {hours.map(h => (
            <div key={h} className={styles.hourRow} style={{ top: h * HOUR_PX, height: HOUR_PX }}>
              <span className={styles.hourLabel} style={gutter ? { width: gutter } : undefined}>
                {minutesToLabel(h * 60)}
              </span>
              <div className={styles.halfHourLine} />
            </div>
          ))}

          {timedStops.map(stop => (
            <TimelineStopBlock
              key={stop.id}
              stop={stop}
              onClick={() => onStopClick(stop)}
              layout={stopColumnLayout.get(stop.id)}
              gutter={gutter}
            />
          ))}

          {continuationLegs.map(leg => (
            <TimelineContinuationBlock
              key={`cont-${leg.id}`}
              leg={leg}
              onClick={() => onLegClick(leg)}
              layout={legColumnLayout.get(leg.id)}
              gutter={gutter}
            />
          ))}
          {timedLegs.map(leg => (
            <TimelineLegBlock
              key={leg.id}
              leg={leg}
              onClick={() => onLegClick(leg)}
              layout={legColumnLayout.get(leg.id)}
              gutter={gutter}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
