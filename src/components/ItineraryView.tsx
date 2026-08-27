import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../lib/supabaseClient'
import { loadGoogleMaps } from '../lib/googleMapsLoader'
import { categoryConfig } from '../lib/pinCategories'
import type { Trip, Pin, ItineraryDay, ItineraryStop } from '../types'
import styles from './ItineraryView.module.css'

interface Props {
  tripId: string
  trip: Trip
}

type StopWithPin = ItineraryStop & { pin: Pin }
type TravelMode = 'DRIVING' | 'WALKING' | 'TRANSIT'

interface Segment {
  distanceText: string
  durationText: string
}

// One calendar date per day in [start, end], inclusive. Parsed/formatted
// as plain YYYY-MM-DD strings (noon-anchored) to sidestep timezone
// off-by-one issues that plain `new Date(dateString)` parsing invites.
function eachDateInRange(start: string, end: string): string[] {
  const dates: string[] = []
  let cur = new Date(`${start}T12:00:00`)
  const last = new Date(`${end}T12:00:00`)
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10))
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000)
  }
  return dates
}

function formatDayDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ItineraryView({ tripId, trip }: Props) {
  const [days, setDays] = useState<ItineraryDay[]>([])
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null)
  const [pins, setPins] = useState<Pin[]>([])
  const [stops, setStops] = useState<StopWithPin[]>([])
  const [loadingDays, setLoadingDays] = useState(true)
  const [addingDay, setAddingDay] = useState(false)
  const [travelMode, setTravelMode] = useState<TravelMode>('DRIVING')
  const [segments, setSegments] = useState<Segment[]>([])
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  const miniMapContainer = useRef<HTMLDivElement>(null)
  const miniMapRef = useRef<google.maps.Map | null>(null)
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const miniMapReady = useRef(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    loadDays()
    loadPins()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])

  useEffect(() => {
    if (!selectedDayId) {
      setStops([])
      return
    }
    loadStops(selectedDayId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayId])

  useEffect(() => {
    loadGoogleMaps().then(() => {
      if (!miniMapContainer.current || miniMapRef.current) return
      const map = new google.maps.Map(miniMapContainer.current, {
        center: { lat: 20, lng: 0 },
        zoom: 2,
        disableDefaultUI: true,
        gestureHandling: 'cooperative'
      })
      miniMapRef.current = map
      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        preserveViewport: true
      })
      miniMapReady.current = true
      drawMiniMap()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    computeRouteAndDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, travelMode])

  async function loadDays() {
    setLoadingDays(true)
    const { data, error } = await supabase
      .from('itinerary_days')
      .select('*')
      .eq('trip_id', tripId)
      .order('day_number')

    if (error) {
      console.error('Failed to load itinerary days', error)
      setLoadingDays(false)
      return
    }

    if ((data ?? []).length === 0 && trip.start_date && trip.end_date) {
      const dates = eachDateInRange(trip.start_date, trip.end_date)
      const rows = dates.map((date, i) => ({ trip_id: tripId, day_number: i + 1, date }))
      const { error: insertError } = await supabase.from('itinerary_days').insert(rows)
      if (insertError) {
        console.error('Failed to auto-generate itinerary days', insertError)
        setLoadingDays(false)
        return
      }
      const { data: regenerated } = await supabase
        .from('itinerary_days')
        .select('*')
        .eq('trip_id', tripId)
        .order('day_number')
      setDays(regenerated ?? [])
      setSelectedDayId(regenerated?.[0]?.id ?? null)
      setLoadingDays(false)
      return
    }

    setDays(data ?? [])
    setSelectedDayId(prev => prev ?? data?.[0]?.id ?? null)
    setLoadingDays(false)
  }

  async function addManualDay() {
    setAddingDay(true)
    const nextNumber = (days[days.length - 1]?.day_number ?? 0) + 1
    const { data, error } = await supabase
      .from('itinerary_days')
      .insert({ trip_id: tripId, day_number: nextNumber, date: null })
      .select()
      .single()
    setAddingDay(false)
    if (error) {
      console.error('Failed to add day', error)
      return
    }
    setDays(prev => [...prev, data])
    setSelectedDayId(data.id)
  }

  async function loadPins() {
    const { data, error } = await supabase.from('pins').select('*').eq('trip_id', tripId)
    if (error) {
      console.error('Failed to load pins', error)
      return
    }
    setPins(data ?? [])
  }

  async function loadStops(dayId: string) {
    const { data, error } = await supabase
      .from('itinerary_stops')
      .select('*, pin:pins(*)')
      .eq('itinerary_day_id', dayId)
      .order('order_index')

    if (error) {
      console.error('Failed to load itinerary stops', error)
      return
    }
    setStops((data ?? []) as unknown as StopWithPin[])
  }

  async function addStopToDay(pinId: string) {
    if (!selectedDayId) return
    if (stops.some(s => s.pin_id === pinId)) return
    const { error } = await supabase.from('itinerary_stops').insert({
      itinerary_day_id: selectedDayId,
      pin_id: pinId,
      order_index: stops.length
    })
    if (error) {
      console.error('Failed to schedule pin', error)
      return
    }
    loadStops(selectedDayId)
  }

  async function removeStopFromDay(stopId: string) {
    const { error } = await supabase.from('itinerary_stops').delete().eq('id', stopId)
    if (error) {
      console.error('Failed to unschedule stop', error)
      return
    }
    if (selectedDayId) loadStops(selectedDayId)
  }

  async function reorderStops(oldIndex: number, newIndex: number) {
    const reordered = arrayMove(stops, oldIndex, newIndex)
    setStops(reordered)
    await Promise.all(
      reordered.map((s, i) =>
        s.order_index === i ? null : supabase.from('itinerary_stops').update({ order_index: i }).eq('id', s.id)
      )
    )
  }

  async function updateStopTime(stopId: string, field: 'start_time' | 'end_time', value: string) {
    const { error } = await supabase
      .from('itinerary_stops')
      .update({ [field]: value || null })
      .eq('id', stopId)
    if (error) {
      console.error('Failed to update stop time', error)
      return
    }
    setStops(prev => prev.map(s => (s.id === stopId ? { ...s, [field]: value || null } : s)))
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null)
    const { active, over } = event
    if (!over) return
    const activeId = active.id as string
    const overId = over.id as string

    if (activeId.startsWith('pool-')) {
      if (overId === 'day-zone' || overId.startsWith('stop-')) {
        addStopToDay(activeId.slice(5))
      }
      return
    }

    if (activeId.startsWith('stop-')) {
      const stopId = activeId.slice(5)
      if (overId === 'pool-zone') {
        removeStopFromDay(stopId)
        return
      }
      if (overId.startsWith('stop-') && overId !== activeId) {
        const oldIndex = stops.findIndex(s => `stop-${s.id}` === activeId)
        const newIndex = stops.findIndex(s => `stop-${s.id}` === overId)
        if (oldIndex !== -1 && newIndex !== -1) reorderStops(oldIndex, newIndex)
      }
    }
  }

  // One Directions request per day (not one per segment) using waypoints
  // for the day's ordered stops, per E26/the plan confirmed with the
  // user. Also feeds the same result into the mini map's route line, so
  // travel-time text and the drawn route always agree and cost one API
  // call between them.
  async function computeRouteAndDraw() {
    if (stops.length < 2) {
      setSegments([])
      drawMiniMap()
      return
    }
    setLoadingRoute(true)
    try {
      await loadGoogleMaps()
      const service = new google.maps.DirectionsService()
      const waypoints = stops.slice(1, -1).map(s => ({
        location: { lat: s.pin.lat, lng: s.pin.lng },
        stopover: true
      }))
      const result = await service.route({
        origin: { lat: stops[0].pin.lat, lng: stops[0].pin.lng },
        destination: { lat: stops[stops.length - 1].pin.lat, lng: stops[stops.length - 1].pin.lng },
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode[travelMode]
      })
      const legs = result.routes[0]?.legs ?? []
      setSegments(
        legs.map(leg => ({
          distanceText: leg.distance?.text ?? '',
          durationText: leg.duration?.text ?? ''
        }))
      )
      if (directionsRendererRef.current) {
        directionsRendererRef.current.setDirections(result)
      }
      drawMiniMap(result)
    } catch (err) {
      console.error('Directions request failed', err)
      setSegments([])
      drawMiniMap()
    } finally {
      setLoadingRoute(false)
    }
  }

  function drawMiniMap(directionsResult?: google.maps.DirectionsResult) {
    const map = miniMapRef.current
    if (!map || !miniMapReady.current) return

    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []

    if (!directionsResult && directionsRendererRef.current) {
      // Safe way to clear a previously-drawn route without feeding the
      // renderer a malformed DirectionsResult: detach and reattach.
      directionsRendererRef.current.setMap(null)
      directionsRendererRef.current.setMap(map)
    }

    if (stops.length === 0) {
      map.setCenter({ lat: 20, lng: 0 })
      map.setZoom(2)
      return
    }

    const bounds = new google.maps.LatLngBounds()
    stops.forEach((stop, i) => {
      const cfg = categoryConfig(stop.pin.category)
      const marker = new google.maps.Marker({
        position: { lat: stop.pin.lat, lng: stop.pin.lng },
        map,
        label: { text: String(i + 1), color: '#FFFFFF', fontSize: '11px', fontWeight: '600' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: cfg.color,
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2
        }
      })
      markersRef.current.push(marker)
      bounds.extend({ lat: stop.pin.lat, lng: stop.pin.lng })
    })

    if (stops.length === 1) {
      map.setCenter({ lat: stops[0].pin.lat, lng: stops[0].pin.lng })
      map.setZoom(14)
    } else {
      map.fitBounds(bounds, 32)
    }
  }

  const scheduledPinIds = useMemo(() => new Set(stops.map(s => s.pin_id)), [stops])
  const unscheduledPins = useMemo(() => pins.filter(p => !scheduledPinIds.has(p.id)), [pins, scheduledPinIds])
  const activePin = activeDragId?.startsWith('pool-')
    ? pins.find(p => p.id === activeDragId.slice(5))
    : undefined
  const activeStop = activeDragId?.startsWith('stop-')
    ? stops.find(s => `stop-${s.id}` === activeDragId)
    : undefined

  if (loadingDays) {
    return <p className={styles.hint}>loading itinerary…</p>
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={styles.wrapper}>
        <div className={styles.dayTabs}>
          {days.map(day => (
            <button
              key={day.id}
              className={`${styles.dayTab} ${selectedDayId === day.id ? styles.dayTabActive : ''}`}
              onClick={() => setSelectedDayId(day.id)}
            >
              day {day.day_number}
              {day.date && <span className={styles.dayTabDate}> · {formatDayDate(day.date)}</span>}
            </button>
          ))}
          <button className={styles.addDayButton} onClick={addManualDay} disabled={addingDay}>
            {addingDay ? '…' : '+ add day'}
          </button>
        </div>

        {days.length === 0 && (
          <p className={styles.hint}>
            no days yet — add one above to start building the itinerary.
          </p>
        )}

        {days.length > 0 && (
          <>
            <PoolZone pins={unscheduledPins} onQuickAdd={addStopToDay} />

            <div className={styles.dayContent}>
              <DayZone
                stops={stops}
                segments={segments}
                loadingRoute={loadingRoute}
                onRemove={removeStopFromDay}
                onTimeChange={updateStopTime}
              />

              <div className={styles.mapPane}>
                <div className={styles.modeToggle}>
                  {(['DRIVING', 'WALKING', 'TRANSIT'] as TravelMode[]).map(mode => (
                    <button
                      key={mode}
                      className={`${styles.modeButton} ${travelMode === mode ? styles.modeButtonActive : ''}`}
                      onClick={() => setTravelMode(mode)}
                      title={mode.toLowerCase()}
                    >
                      {mode === 'DRIVING' ? '🚗' : mode === 'WALKING' ? '🚶' : '🚌'}
                    </button>
                  ))}
                </div>
                <div ref={miniMapContainer} className={styles.miniMap} />
              </div>
            </div>
          </>
        )}
      </div>

      <DragOverlay>
        {activePin && (
          <div className={styles.poolChip}>
            <span
              className={styles.poolChipDot}
              style={{ backgroundColor: categoryConfig(activePin.category).color }}
            />
            <span>{activePin.name}</span>
          </div>
        )}
        {activeStop && (
          <div className={styles.stopRow}>
            <span
              className={styles.stopDot}
              style={{ backgroundColor: categoryConfig(activeStop.pin.category).color }}
            />
            <span className={styles.stopName}>{activeStop.pin.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function PoolZone({
  pins,
  onQuickAdd
}: {
  pins: Pin[]
  onQuickAdd: (pinId: string) => void
}) {
  const { setNodeRef } = useDroppable({ id: 'pool-zone' })

  return (
    <div className={styles.poolSection}>
      <p className={styles.poolLabel}>unscheduled · drag onto the day, or tap +</p>
      <div ref={setNodeRef} className={styles.poolList}>
        {pins.length === 0 && <p className={styles.hint}>everything's scheduled, or no pins yet.</p>}
        {pins.map(pin => (
          <PoolChip key={pin.id} pin={pin} onQuickAdd={onQuickAdd} />
        ))}
      </div>
    </div>
  )
}

function PoolChip({ pin, onQuickAdd }: { pin: Pin; onQuickAdd: (pinId: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `pool-${pin.id}` })
  const cfg = categoryConfig(pin.category)

  return (
    <div
      ref={setNodeRef}
      className={styles.poolChip}
      style={{
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        opacity: isDragging ? 0.4 : 1
      }}
      {...listeners}
      {...attributes}
    >
      <span className={styles.poolChipDot} style={{ backgroundColor: cfg.color }} />
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

function DayZone({
  stops,
  segments,
  loadingRoute,
  onRemove,
  onTimeChange
}: {
  stops: StopWithPin[]
  segments: Segment[]
  loadingRoute: boolean
  onRemove: (stopId: string) => void
  onTimeChange: (stopId: string, field: 'start_time' | 'end_time', value: string) => void
}) {
  const { setNodeRef } = useDroppable({ id: 'day-zone' })

  return (
    <div ref={setNodeRef} className={styles.dayList}>
      {stops.length === 0 && <p className={styles.hint}>drag pins here to build this day's plan.</p>}
      <SortableContext items={stops.map(s => `stop-${s.id}`)} strategy={verticalListSortingStrategy}>
        {stops.map((stop, i) => (
          <div key={stop.id}>
            <StopRow stop={stop} onRemove={onRemove} onTimeChange={onTimeChange} />
            {i < stops.length - 1 && (
              <div className={styles.segment}>
                {loadingRoute ? '…' : segments[i] ? `${segments[i].durationText} · ${segments[i].distanceText}` : ''}
              </div>
            )}
          </div>
        ))}
      </SortableContext>
    </div>
  )
}

function StopRow({
  stop,
  onRemove,
  onTimeChange
}: {
  stop: StopWithPin
  onRemove: (stopId: string) => void
  onTimeChange: (stopId: string, field: 'start_time' | 'end_time', value: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `stop-${stop.id}`
  })
  const cfg = categoryConfig(stop.pin.category)

  return (
    <div
      ref={setNodeRef}
      className={styles.stopRow}
      style={{
        transform: transform ? CSS.Transform.toString(transform) : undefined,
        transition,
        opacity: isDragging ? 0.4 : 1
      }}
    >
      <span className={styles.dragHandle} {...listeners} {...attributes}>
        ⠿
      </span>
      <span className={styles.stopDot} style={{ backgroundColor: cfg.color }} />
      <div className={styles.stopMain}>
        <p className={styles.stopName}>{stop.pin.name}</p>
        <div className={styles.stopTimes}>
          <input
            type="time"
            className={styles.timeInput}
            defaultValue={stop.start_time ?? ''}
            onBlur={e => onTimeChange(stop.id, 'start_time', e.target.value)}
          />
          <span className={styles.timeSep}>–</span>
          <input
            type="time"
            className={styles.timeInput}
            defaultValue={stop.end_time ?? ''}
            onBlur={e => onTimeChange(stop.id, 'end_time', e.target.value)}
          />
        </div>
      </div>
      <button
        type="button"
        className={styles.removeButton}
        title="remove from day"
        aria-label="remove from day"
        onClick={() => onRemove(stop.id)}
      >
        ×
      </button>
    </div>
  )
}
