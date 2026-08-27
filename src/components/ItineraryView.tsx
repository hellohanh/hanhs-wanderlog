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
import { supabase } from '../lib/supabaseClient'
import { loadGoogleMaps } from '../lib/googleMapsLoader'
import { categoryConfig, groupPinsByCategory } from '../lib/pinCategories'
import type { Trip, Pin, ItineraryDay, ItineraryStop, TravelLeg, TravelMode as LegMode } from '../types'
import styles from './ItineraryView.module.css'

interface Props {
  tripId: string
  trip: Trip
}

type StopWithPin = ItineraryStop & { pin: Pin }
type RouteMode = 'DRIVING' | 'WALKING' | 'TRANSIT'

interface LegFormState {
  id?: string
  mode: LegMode
  carrier: string
  reference: string
  fromLocation: string
  fromTime: string
  toLocation: string
  toTime: string
}

// Icon + color per travel-leg mode, independent of the pin category
// colors (these are a different concept — a day's travel card, not a
// map pin). No live status/tracking here (out of scope, E9) — just the
// mode's look.
const LEG_MODE_CONFIG: Record<LegMode, { label: string; color: string; svg: string }> = {
  flight: {
    label: 'Flight',
    color: '#378ADD',
    svg: `<svg width="14" height="14" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V4.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-3 2v1.5l4.5-1 4.5 1V21l-3-2v-4.5l8 2.5z" fill="white"/></svg>`
  },
  train: {
    label: 'Train',
    color: '#7F77DD',
    svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="12" rx="2"/><line x1="5" y1="10" x2="19" y2="10"/><circle cx="8.5" cy="18" r="1.3" fill="white" stroke="none"/><circle cx="15.5" cy="18" r="1.3" fill="white" stroke="none"/><line x1="8" y1="18" x2="6" y2="21"/><line x1="16" y1="18" x2="18" y2="21"/></svg>`
  },
  bus: {
    label: 'Bus',
    color: '#1D9E75',
    svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="11" rx="2"/><line x1="3" y1="11" x2="21" y2="11"/><line x1="7" y1="6" x2="7" y2="11"/><line x1="17" y1="6" x2="17" y2="11"/><circle cx="7" cy="19" r="1.4" fill="white" stroke="none"/><circle cx="17" cy="19" r="1.4" fill="white" stroke="none"/></svg>`
  },
  personal: {
    label: 'Personal',
    color: '#888780',
    svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><circle cx="7.5" cy="17" r="1.4" fill="white" stroke="none"/><circle cx="16.5" cy="17" r="1.4" fill="white" stroke="none"/></svg>`
  }
}

interface Segment {
  distanceText: string
  durationText: string
}

// --- Time <-> minutes-of-day helpers, used throughout the timeline ---
const HOUR_PX = 60
const SNAP_MIN = 15
const DEFAULT_DURATION_MIN = 60
const MIN_BLOCK_PX = 22
const SCROLL_TO_HOUR = 7
const DAY_MINUTES = 24 * 60

function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

function minutesToTime(m: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES - 1, m))
  const h = Math.floor(clamped / 60)
  const mm = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:00 ${suffix}`
}

function snapMinutes(m: number): number {
  const snapped = Math.round(m / SNAP_MIN) * SNAP_MIN
  return Math.max(0, Math.min(DAY_MINUTES - SNAP_MIN, snapped))
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
  const [travelLegs, setTravelLegs] = useState<TravelLeg[]>([])
  const [legForm, setLegForm] = useState<LegFormState | null>(null)
  const [savingLeg, setSavingLeg] = useState(false)
  const [editingStop, setEditingStop] = useState<StopWithPin | null>(null)
  const [savingStop, setSavingStop] = useState(false)
  const [loadingDays, setLoadingDays] = useState(true)
  const [addingDay, setAddingDay] = useState(false)
  const [routeMode, setRouteMode] = useState<RouteMode>('DRIVING')
  const [segments, setSegments] = useState<Segment[]>([])
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [showMapPopup, setShowMapPopup] = useState(false)

  const miniMapContainer = useRef<HTMLDivElement>(null)
  const miniMapRef = useRef<google.maps.Map | null>(null)
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const miniMapReady = useRef(false)
  const timelineWrapperRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    loadDays()
    loadPins()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])

  useEffect(() => {
    setLegForm(null)
    setEditingStop(null)
    setShowMapPopup(false)
    if (!selectedDayId) {
      setStops([])
      setTravelLegs([])
      return
    }
    loadStops(selectedDayId)
    loadTravelLegs(selectedDayId)
    // Reset scroll to the 7am default whenever the selected day changes.
    requestAnimationFrame(() => {
      timelineWrapperRef.current?.scrollTo({ top: SCROLL_TO_HOUR * HOUR_PX })
    })
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
  }, [stops, routeMode])

  // The mini map's container stays mounted but hidden (display:none via
  // CSS) while the popup is closed — reopening needs a resize kick or
  // Google Maps keeps whatever stale size it last measured (see L16).
  useEffect(() => {
    if (showMapPopup && miniMapRef.current) {
      setTimeout(() => {
        if (miniMapRef.current) google.maps.event.trigger(miniMapRef.current, 'resize')
        drawMiniMap()
      }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMapPopup])

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

  async function loadTravelLegs(dayId: string) {
    const { data, error } = await supabase
      .from('travel_legs')
      .select('*')
      .eq('itinerary_day_id', dayId)
      .order('order_index')

    if (error) {
      console.error('Failed to load travel legs', error)
      return
    }
    setTravelLegs(data ?? [])
  }

  function startAddLeg() {
    setLegForm({
      mode: 'flight',
      carrier: '',
      reference: '',
      fromLocation: '',
      fromTime: '',
      toLocation: '',
      toTime: ''
    })
  }

  function startEditLeg(leg: TravelLeg) {
    setLegForm({
      id: leg.id,
      mode: leg.mode,
      carrier: leg.carrier ?? '',
      reference: leg.reference ?? '',
      fromLocation: leg.from_location,
      fromTime: leg.from_time ?? '',
      toLocation: leg.to_location,
      toTime: leg.to_time ?? ''
    })
  }

  async function saveLeg() {
    if (!legForm || !selectedDayId) return
    if (!legForm.fromLocation.trim() || !legForm.toLocation.trim()) return

    setSavingLeg(true)
    const payload = {
      itinerary_day_id: selectedDayId,
      mode: legForm.mode,
      carrier: legForm.carrier.trim() || null,
      reference: legForm.reference.trim() || null,
      from_location: legForm.fromLocation.trim(),
      from_time: legForm.fromTime || null,
      to_location: legForm.toLocation.trim(),
      to_time: legForm.toTime || null
    }

    const { error } = legForm.id
      ? await supabase.from('travel_legs').update(payload).eq('id', legForm.id)
      : await supabase.from('travel_legs').insert({ ...payload, order_index: travelLegs.length })

    setSavingLeg(false)
    if (error) {
      console.error('Failed to save travel leg', error)
      return
    }
    setLegForm(null)
    loadTravelLegs(selectedDayId)
  }

  async function deleteLeg(legId: string) {
    if (!selectedDayId) return
    const { error } = await supabase.from('travel_legs').delete().eq('id', legId)
    if (error) {
      console.error('Failed to delete travel leg', error)
      return
    }
    setLegForm(null)
    loadTravelLegs(selectedDayId)
  }

  async function moveLegToTime(legId: string, newFromMin: number) {
    const leg = travelLegs.find(l => l.id === legId)
    if (!leg) return
    const oldFrom = timeToMinutes(leg.from_time)
    const oldTo = timeToMinutes(leg.to_time)
    const duration = oldFrom != null && oldTo != null ? oldTo - oldFrom : null
    const newFrom = snapMinutes(newFromMin)
    const newTo = duration != null && duration > 0 ? Math.min(DAY_MINUTES - 1, newFrom + duration) : oldTo

    const { error } = await supabase
      .from('travel_legs')
      .update({ from_time: minutesToTime(newFrom), to_time: newTo != null ? minutesToTime(newTo) : null })
      .eq('id', legId)
    if (error) {
      console.error('Failed to move travel leg', error)
      return
    }
    if (selectedDayId) loadTravelLegs(selectedDayId)
  }

  // Quick-add (the "+" on a pool chip, no drag) needs a sensible default
  // time since scheduling now means placing something on the timeline.
  // Defaults to right after the last-ending scheduled item, or 9am if
  // the day is empty.
  function nextDefaultStartMinutes(): number {
    const ends = stops
      .map(s => {
        const start = timeToMinutes(s.start_time)
        const end = timeToMinutes(s.end_time)
        return end ?? (start != null ? start + DEFAULT_DURATION_MIN : null)
      })
      .filter((m): m is number => m != null)
    if (ends.length === 0) return 9 * 60
    return snapMinutes(Math.min(DAY_MINUTES - DEFAULT_DURATION_MIN, Math.max(...ends)))
  }

  async function addStopToDayAtTime(pinId: string, startMin: number) {
    if (!selectedDayId) return
    if (stops.some(s => s.pin_id === pinId)) return
    const start = snapMinutes(startMin)
    const end = Math.min(DAY_MINUTES - 1, start + DEFAULT_DURATION_MIN)
    const { error } = await supabase.from('itinerary_stops').insert({
      itinerary_day_id: selectedDayId,
      pin_id: pinId,
      order_index: stops.length,
      start_time: minutesToTime(start),
      end_time: minutesToTime(end)
    })
    if (error) {
      console.error('Failed to schedule pin', error)
      return
    }
    loadStops(selectedDayId)
  }

  async function moveStopToTime(stopId: string, newStartMin: number) {
    const stop = stops.find(s => s.id === stopId)
    if (!stop) return
    const oldStart = timeToMinutes(stop.start_time)
    const oldEnd = timeToMinutes(stop.end_time)
    const duration = oldStart != null && oldEnd != null ? oldEnd - oldStart : DEFAULT_DURATION_MIN
    const newStart = snapMinutes(newStartMin)
    const newEnd = Math.min(DAY_MINUTES - 1, newStart + Math.max(duration, SNAP_MIN))

    const { error } = await supabase
      .from('itinerary_stops')
      .update({ start_time: minutesToTime(newStart), end_time: minutesToTime(newEnd) })
      .eq('id', stopId)
    if (error) {
      console.error('Failed to move stop', error)
      return
    }
    if (selectedDayId) loadStops(selectedDayId)
  }

  async function removeStopFromDay(stopId: string) {
    const { error } = await supabase.from('itinerary_stops').delete().eq('id', stopId)
    if (error) {
      console.error('Failed to unschedule stop', error)
      return
    }
    setEditingStop(null)
    if (selectedDayId) loadStops(selectedDayId)
  }

  async function saveStopTimes(stopId: string, startTime: string, endTime: string) {
    setSavingStop(true)
    const { error } = await supabase
      .from('itinerary_stops')
      .update({ start_time: startTime || null, end_time: endTime || null })
      .eq('id', stopId)
    setSavingStop(false)
    if (error) {
      console.error('Failed to update stop time', error)
      return
    }
    setEditingStop(null)
    if (selectedDayId) loadStops(selectedDayId)
  }

  // Converts a drag's final on-screen position into a minutes-of-day
  // value, relative to the timeline's full scrollable track (not just
  // the visible viewport) — accounts for however far the wrapper is
  // currently scrolled.
  function dropMinutesFromEvent(event: DragEndEvent): number | null {
    const wrapper = timelineWrapperRef.current
    const draggedRect = event.active.rect.current.translated
    if (!wrapper || !draggedRect) return null
    const wrapperRect = wrapper.getBoundingClientRect()
    const relativeY = draggedRect.top - wrapperRect.top + wrapper.scrollTop
    const minutes = (relativeY / HOUR_PX) * 60
    return snapMinutes(minutes)
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
      if (overId === 'timeline-zone') {
        const minutes = dropMinutesFromEvent(event)
        addStopToDayAtTime(activeId.slice(5), minutes ?? nextDefaultStartMinutes())
      }
      return
    }

    if (activeId.startsWith('tstop-')) {
      const stopId = activeId.slice(6)
      if (overId === 'pool-zone') {
        removeStopFromDay(stopId)
        return
      }
      if (overId === 'timeline-zone') {
        const minutes = dropMinutesFromEvent(event)
        if (minutes != null) moveStopToTime(stopId, minutes)
      }
      return
    }

    if (activeId.startsWith('tleg-')) {
      const legId = activeId.slice(5)
      if (overId === 'timeline-zone') {
        const minutes = dropMinutesFromEvent(event)
        if (minutes != null) moveLegToTime(legId, minutes)
      }
    }
  }

  // One Directions request per day (not one per segment) using waypoints
  // for the day's time-ordered stops. Only stops with a start_time are
  // included — a stop scheduled to this day but never given a time has
  // no meaningful position in a chronological route. Also feeds the
  // same result into the mini map's route line, so travel-time text and
  // the drawn route always agree and cost one API call between them.
  async function computeRouteAndDraw() {
    const timedStops = [...stops]
      .filter(s => s.start_time != null)
      .sort((a, b) => (timeToMinutes(a.start_time) ?? 0) - (timeToMinutes(b.start_time) ?? 0))

    if (timedStops.length < 2) {
      setSegments([])
      drawMiniMap(undefined, timedStops)
      return
    }
    setLoadingRoute(true)
    try {
      await loadGoogleMaps()
      const service = new google.maps.DirectionsService()
      const waypoints = timedStops.slice(1, -1).map(s => ({
        location: { lat: s.pin.lat, lng: s.pin.lng },
        stopover: true
      }))
      const result = await service.route({
        origin: { lat: timedStops[0].pin.lat, lng: timedStops[0].pin.lng },
        destination: { lat: timedStops[timedStops.length - 1].pin.lat, lng: timedStops[timedStops.length - 1].pin.lng },
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode[routeMode]
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
      drawMiniMap(result, timedStops)
    } catch (err) {
      console.error('Directions request failed', err)
      setSegments([])
      drawMiniMap(undefined, timedStops)
    } finally {
      setLoadingRoute(false)
    }
  }

  function drawMiniMap(directionsResult?: google.maps.DirectionsResult, timedStops: StopWithPin[] = []) {
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

    if (timedStops.length === 0) {
      map.setCenter({ lat: 20, lng: 0 })
      map.setZoom(2)
      return
    }

    const bounds = new google.maps.LatLngBounds()
    timedStops.forEach((stop, i) => {
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

    if (timedStops.length === 1) {
      map.setCenter({ lat: timedStops[0].pin.lat, lng: timedStops[0].pin.lng })
      map.setZoom(14)
    } else {
      map.fitBounds(bounds, 32)
    }
  }

  const scheduledPinIds = useMemo(() => new Set(stops.map(s => s.pin_id)), [stops])
  const unscheduledPins = useMemo(() => pins.filter(p => !scheduledPinIds.has(p.id)), [pins, scheduledPinIds])
  const timedStops = useMemo(
    () =>
      [...stops]
        .filter(s => s.start_time != null)
        .sort((a, b) => (timeToMinutes(a.start_time) ?? 0) - (timeToMinutes(b.start_time) ?? 0)),
    [stops]
  )
  const timedLegs = useMemo(
    () =>
      [...travelLegs]
        .filter(l => l.from_time != null)
        .sort((a, b) => (timeToMinutes(a.from_time) ?? 0) - (timeToMinutes(b.from_time) ?? 0)),
    [travelLegs]
  )

  const activePin = activeDragId?.startsWith('pool-') ? pins.find(p => p.id === activeDragId.slice(5)) : undefined
  const activeStop = activeDragId?.startsWith('tstop-')
    ? stops.find(s => s.id === activeDragId.slice(6))
    : undefined
  const activeLeg = activeDragId?.startsWith('tleg-')
    ? travelLegs.find(l => l.id === activeDragId.slice(5))
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
          <p className={styles.hint}>no days yet — add one above to start building the itinerary.</p>
        )}

        {days.length > 0 && (
          <>
            <div className={styles.travelHeader}>
              <div className={styles.travelChipsRow}>
                <p className={styles.travelLabel}>travel</p>
                {travelLegs.map(leg => {
                  const cfg = LEG_MODE_CONFIG[leg.mode]
                  return (
                    <button
                      key={leg.id}
                      type="button"
                      className={styles.travelChip}
                      onClick={() => startEditLeg(leg)}
                    >
                      <span className={styles.travelChipIcon} style={{ backgroundColor: cfg.color }}>
                        <span dangerouslySetInnerHTML={{ __html: cfg.svg }} />
                      </span>
                      {leg.carrier || cfg.label}
                      {leg.reference ? ` ${leg.reference}` : ''}
                      {leg.from_time ? ` · ${leg.from_time.slice(0, 5)}` : ''}
                    </button>
                  )
                })}
                <button type="button" className={styles.addTravelButton} onClick={startAddLeg}>
                  + add travel
                </button>
              </div>
              <button type="button" className={styles.mapToggleButton} onClick={() => setShowMapPopup(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 20l-5-2V6l5 2 6-2 5 2v12l-5-2-6 2z" />
                  <line x1="9" y1="8" x2="9" y2="20" />
                  <line x1="15" y1="6" x2="15" y2="18" />
                </svg>
                map
              </button>
            </div>

            <div className={styles.dayContent}>
              <TimelineZone
                scrollRef={timelineWrapperRef}
                timedStops={timedStops}
                timedLegs={timedLegs}
                onStopClick={setEditingStop}
                onLegClick={startEditLeg}
              />

              <div className={styles.poolColumn}>
                <PoolZone
                  pins={unscheduledPins}
                  onQuickAdd={pinId => addStopToDayAtTime(pinId, nextDefaultStartMinutes())}
                />
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
          <div className={styles.dragPreviewBlock} style={{ backgroundColor: categoryConfig(activeStop.pin.category).color }}>
            {activeStop.pin.name}
          </div>
        )}
        {activeLeg && (
          <div className={styles.dragPreviewBlock} style={{ backgroundColor: LEG_MODE_CONFIG[activeLeg.mode].color }}>
            {activeLeg.carrier || LEG_MODE_CONFIG[activeLeg.mode].label}
          </div>
        )}
      </DragOverlay>

      {editingStop && (
        <StopEditPopup
          stop={editingStop}
          saving={savingStop}
          onSave={saveStopTimes}
          onRemove={removeStopFromDay}
          onClose={() => setEditingStop(null)}
        />
      )}

      {legForm && (
        <div className={styles.popupBackdrop} onClick={() => setLegForm(null)}>
          <div className={styles.popupCard} onClick={e => e.stopPropagation()}>
            <TravelLegForm
              form={legForm}
              saving={savingLeg}
              onChange={setLegForm}
              onSave={saveLeg}
              onCancel={() => setLegForm(null)}
              onDelete={legForm.id ? () => deleteLeg(legForm.id!) : undefined}
            />
          </div>
        </div>
      )}

      {/* Mini map's container stays mounted (see the resize-on-open
          effect above, per L16) — only visibility toggles. */}
      <div className={styles.popupBackdrop} style={{ display: showMapPopup ? 'flex' : 'none' }} onClick={() => setShowMapPopup(false)}>
        <div className={styles.mapPopupCard} onClick={e => e.stopPropagation()}>
          <div className={styles.modeToggle}>
            {(['DRIVING', 'WALKING', 'TRANSIT'] as RouteMode[]).map(mode => (
              <button
                key={mode}
                className={`${styles.modeButton} ${routeMode === mode ? styles.modeButtonActive : ''}`}
                onClick={() => setRouteMode(mode)}
                title={mode.toLowerCase()}
              >
                {mode === 'DRIVING' ? '🚗' : mode === 'WALKING' ? '🚶' : '🚌'}
              </button>
            ))}
            <button type="button" className={styles.popupCloseButton} onClick={() => setShowMapPopup(false)}>
              close
            </button>
          </div>
          <div ref={miniMapContainer} className={styles.miniMap} />
          {timedStops.length >= 2 && (
            <div className={styles.segmentList}>
              {timedStops.slice(0, -1).map((stop, i) => (
                <div key={stop.id} className={styles.segmentRow}>
                  <span>{stop.pin.name} → {timedStops[i + 1].pin.name}</span>
                  <span className={styles.segmentTime}>
                    {loadingRoute ? '…' : segments[i] ? `${segments[i].durationText} · ${segments[i].distanceText}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DndContext>
  )
}

function TravelLegForm({
  form,
  saving,
  onChange,
  onSave,
  onCancel,
  onDelete
}: {
  form: LegFormState
  saving: boolean
  onChange: (form: LegFormState) => void
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
}) {
  return (
    <div className={styles.travelForm}>
      <div className={styles.travelModePicker}>
        {(Object.keys(LEG_MODE_CONFIG) as LegMode[]).map(mode => {
          const cfg = LEG_MODE_CONFIG[mode]
          return (
            <button
              key={mode}
              type="button"
              className={styles.travelModePill}
              style={form.mode === mode ? { borderColor: cfg.color, color: cfg.color, fontWeight: 500 } : undefined}
              onClick={() => onChange({ ...form, mode })}
            >
              <span className={styles.travelModeDot} style={{ backgroundColor: cfg.color }} />
              {cfg.label}
            </button>
          )
        })}
      </div>

      <div className={styles.travelFormRow}>
        <input
          className={styles.travelFormInput}
          placeholder="carrier (e.g. Delta)"
          value={form.carrier}
          onChange={e => onChange({ ...form, carrier: e.target.value })}
        />
        <input
          className={styles.travelFormInput}
          placeholder="number (e.g. DL 383)"
          value={form.reference}
          onChange={e => onChange({ ...form, reference: e.target.value })}
        />
      </div>

      <div className={styles.travelFormRow}>
        <input
          className={styles.travelFormInput}
          placeholder="from (e.g. San Francisco / SFO)"
          value={form.fromLocation}
          onChange={e => onChange({ ...form, fromLocation: e.target.value })}
          autoFocus
        />
        <input
          type="time"
          className={styles.travelFormTimeInput}
          value={form.fromTime}
          onChange={e => onChange({ ...form, fromTime: e.target.value })}
        />
      </div>

      <div className={styles.travelFormRow}>
        <input
          className={styles.travelFormInput}
          placeholder="to (e.g. New York / JFK)"
          value={form.toLocation}
          onChange={e => onChange({ ...form, toLocation: e.target.value })}
        />
        <input
          type="time"
          className={styles.travelFormTimeInput}
          value={form.toTime}
          onChange={e => onChange({ ...form, toTime: e.target.value })}
        />
      </div>

      <div className={styles.travelFormActions}>
        <button
          type="button"
          className={styles.travelFormSave}
          onClick={onSave}
          disabled={saving || !form.fromLocation.trim() || !form.toLocation.trim()}
        >
          {saving ? '…' : 'save'}
        </button>
        <button type="button" className={styles.travelFormCancel} onClick={onCancel} disabled={saving}>
          cancel
        </button>
        {onDelete && (
          <button type="button" className={styles.travelFormDelete} onClick={onDelete} disabled={saving}>
            delete
          </button>
        )}
      </div>
    </div>
  )
}

function StopEditPopup({
  stop,
  saving,
  onSave,
  onRemove,
  onClose
}: {
  stop: StopWithPin
  saving: boolean
  onSave: (stopId: string, startTime: string, endTime: string) => void
  onRemove: (stopId: string) => void
  onClose: () => void
}) {
  const [start, setStart] = useState(stop.start_time ?? '')
  const [end, setEnd] = useState(stop.end_time ?? '')
  const cfg = categoryConfig(stop.pin.category)

  return (
    <div className={styles.popupBackdrop} onClick={onClose}>
      <div className={styles.popupCard} onClick={e => e.stopPropagation()}>
        <div className={styles.stopEditHeader}>
          <span className={styles.stopEditDot} style={{ backgroundColor: cfg.color }} />
          <p className={styles.stopEditName}>{stop.pin.name}</p>
        </div>
        <div className={styles.travelFormRow}>
          <input type="time" className={styles.travelFormTimeInput} value={start} onChange={e => setStart(e.target.value)} />
          <span className={styles.timeSep}>–</span>
          <input type="time" className={styles.travelFormTimeInput} value={end} onChange={e => setEnd(e.target.value)} />
        </div>
        <div className={styles.travelFormActions}>
          <button
            type="button"
            className={styles.travelFormSave}
            onClick={() => onSave(stop.id, start, end)}
            disabled={saving}
          >
            {saving ? '…' : 'save'}
          </button>
          <button type="button" className={styles.travelFormCancel} onClick={onClose} disabled={saving}>
            cancel
          </button>
          <button type="button" className={styles.travelFormDelete} onClick={() => onRemove(stop.id)} disabled={saving}>
            remove
          </button>
        </div>
      </div>
    </div>
  )
}

function PoolZone({ pins, onQuickAdd }: { pins: Pin[]; onQuickAdd: (pinId: string) => void }) {
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

function PoolChip({ pin, onQuickAdd }: { pin: Pin; onQuickAdd: (pinId: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `pool-${pin.id}` })
  const cfg = categoryConfig(pin.category)

  return (
    <div
      ref={setNodeRef}
      className={styles.poolChip}
      style={{ opacity: isDragging ? 0.4 : 1 }}
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

interface TimelineZoneProps {
  timedStops: StopWithPin[]
  timedLegs: TravelLeg[]
  onStopClick: (stop: StopWithPin) => void
  onLegClick: (leg: TravelLeg) => void
}

// forwardRef isn't imported/used elsewhere in this codebase's style, so
// this takes the scroll/droppable ref as a prop instead — simpler than
// introducing forwardRef for one component.
function TimelineZone({
  timedStops,
  timedLegs,
  onStopClick,
  onLegClick,
  scrollRef
}: TimelineZoneProps & { scrollRef: React.RefObject<HTMLDivElement> }) {
  const { setNodeRef } = useDroppable({ id: 'timeline-zone' })

  function combinedRef(node: HTMLDivElement | null) {
    setNodeRef(node)
    ;(scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node
  }

  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    <div className={styles.timelineWrapper}>
      <div ref={combinedRef} className={styles.timelineScroll}>
        <div className={styles.timelineTrack} style={{ height: 24 * HOUR_PX }}>
          {hours.map(h => (
            <div key={h} className={styles.hourRow} style={{ top: h * HOUR_PX, height: HOUR_PX }}>
              <span className={styles.hourLabel}>{minutesToLabel(h * 60)}</span>
              <div className={styles.halfHourLine} />
            </div>
          ))}

          {timedStops.map(stop => (
            <TimelineStopBlock key={stop.id} stop={stop} onClick={() => onStopClick(stop)} />
          ))}
          {timedLegs.map(leg => (
            <TimelineLegBlock key={leg.id} leg={leg} onClick={() => onLegClick(leg)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TimelineStopBlock({ stop, onClick }: { stop: StopWithPin; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tstop-${stop.id}` })
  const cfg = categoryConfig(stop.pin.category)
  const start = timeToMinutes(stop.start_time) ?? 0
  const end = timeToMinutes(stop.end_time)
  const top = (start / 60) * HOUR_PX
  const height = Math.max(MIN_BLOCK_PX, ((end != null ? end - start : DEFAULT_DURATION_MIN) / 60) * HOUR_PX)

  return (
    <div
      ref={setNodeRef}
      className={styles.timelineBlock}
      style={{ top, height, backgroundColor: cfg.color, opacity: isDragging ? 0.4 : 1 }}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <span className={styles.timelineBlockName}>{stop.pin.name}</span>
      <span className={styles.timelineBlockTime}>
        {stop.start_time?.slice(0, 5)}
        {stop.end_time ? `–${stop.end_time.slice(0, 5)}` : ''}
      </span>
    </div>
  )
}

function TimelineLegBlock({ leg, onClick }: { leg: TravelLeg; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tleg-${leg.id}` })
  const cfg = LEG_MODE_CONFIG[leg.mode]
  const start = timeToMinutes(leg.from_time) ?? 0
  const end = timeToMinutes(leg.to_time)
  const top = (start / 60) * HOUR_PX
  const height = Math.max(MIN_BLOCK_PX, ((end != null ? end - start : DEFAULT_DURATION_MIN) / 60) * HOUR_PX)

  return (
    <div
      ref={setNodeRef}
      className={styles.timelineBlock}
      style={{ top, height, backgroundColor: cfg.color, opacity: isDragging ? 0.4 : 1 }}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <span className={styles.timelineBlockIcon} dangerouslySetInnerHTML={{ __html: cfg.svg }} />
      <span className={styles.timelineBlockName}>{leg.carrier || cfg.label}{leg.reference ? ` ${leg.reference}` : ''}</span>
      <span className={styles.timelineBlockTime}>
        {leg.from_time?.slice(0, 5)}
        {leg.to_time ? `–${leg.to_time.slice(0, 5)}` : ''}
      </span>
    </div>
  )
}
