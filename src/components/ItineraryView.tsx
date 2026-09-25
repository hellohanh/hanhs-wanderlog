import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { supabase } from '../lib/supabaseClient'
import { loadGoogleMaps } from '../lib/googleMapsLoader'
import { pinBadgeColor } from '../lib/pinCategories'
import {
  DAY_MINUTES,
  DEFAULT_DURATION_MIN,
  HOUR_PX,
  LEG_MODE_CONFIG,
  SCROLL_TO_HOUR,
  SNAP_MIN,
  computeColumnLayout,
  continuationBlockGeometry,
  formatDayDate,
  legBlockGeometry,
  minutesToTime,
  snapMinutes,
  stopBlockGeometry,
  timeToMinutes
} from '../lib/itineraryLayout'
import {
  PoolZone,
  TimelineZone,
  TravelCardFull,
  type StopWithPin
} from './ItineraryTimeline'
import timelineStyles from './ItineraryTimeline.module.css'
import type { Trip, Pin, ItineraryDay, TravelLeg, TravelMode as LegMode } from '../types'
import styles from './ItineraryView.module.css'

interface Props {
  tripId: string
  trip: Trip
}

type RouteMode = 'DRIVING' | 'WALKING' | 'TRANSIT'

interface LegFormState {
  id?: string
  mode: LegMode
  title: string
  carrier: string
  reference: string
  fromLocation: string
  fromDate: string
  fromTime: string
  fromTimezone: string
  toLocation: string
  toDate: string
  toTime: string
  toTimezone: string
}

// Curated airline list for the flight-mode carrier autocomplete. `value`
// is what actually fills the carrier field on selection — a short,
// commonly-typed form, chosen to match slugifyCarrier()'s output to a
// real logo filename (see chat: e.g. "Delta" -> delta.png, not
// "Delta Air Lines" -> delta-air-lines.png). `display` is only for the
// dropdown label, so the full/official name is still visible there.
const AIRLINES: { display: string; value: string }[] = [
  { display: 'American Airlines', value: 'American Airlines' },
  { display: 'Delta Air Lines', value: 'Delta' },
  { display: 'United Airlines', value: 'United Airlines' },
  { display: 'Southwest Airlines', value: 'Southwest Airlines' },
  { display: 'Alaska Airlines', value: 'Alaska Airlines' },
  { display: 'JetBlue Airways', value: 'JetBlue' },
  { display: 'Hawaiian Airlines', value: 'Hawaiian Airlines' },
  { display: 'Air Canada', value: 'Air Canada' },
  { display: 'Aeroméxico', value: 'Aeroméxico' },
  { display: 'British Airways', value: 'British Airways' },
  { display: 'Lufthansa', value: 'Lufthansa' },
  { display: 'Air France', value: 'Air France' },
  { display: 'KLM Royal Dutch Airlines', value: 'KLM' },
  { display: 'Iberia', value: 'Iberia' },
  { display: 'Swiss International Air Lines', value: 'Swiss' },
  { display: 'Turkish Airlines', value: 'Turkish Airlines' },
  { display: 'Scandinavian Airlines (SAS)', value: 'SAS' },
  { display: 'Virgin Atlantic', value: 'Virgin Atlantic' },
  { display: 'Emirates', value: 'Emirates' },
  { display: 'Qatar Airways', value: 'Qatar Airways' },
  { display: 'Etihad Airways', value: 'Etihad Airways' },
  { display: 'Saudia', value: 'Saudia' },
  { display: 'Singapore Airlines', value: 'Singapore Airlines' },
  { display: 'ANA (All Nippon Airways)', value: 'ANA' },
  { display: 'Japan Airlines (JAL)', value: 'JAL' },
  { display: 'Korean Air', value: 'Korean Air' },
  { display: 'Cathay Pacific', value: 'Cathay Pacific' },
  { display: 'EVA Air', value: 'EVA Air' },
  { display: 'Vietnam Airlines', value: 'Vietnam Airlines' },
  { display: 'Qantas', value: 'Qantas' }
]

// Curated major-airport list for the flight-mode from/to picker.
// Selecting one fills BOTH the location field (as "City / CODE", same
// format the old free-text placeholder suggested) and the timezone
// field in one step — the real fix for the duration bug: a picked
// airport always has a valid IANA timezone, so there's no way to end
// up with typed-but-not-selected text that Intl can't resolve.
interface Airport {
  code: string
  city: string
  timezone: string
}

const AIRPORTS: Airport[] = [
  { code: 'ATL', city: 'Atlanta', timezone: 'America/New_York' },
  { code: 'JFK', city: 'New York', timezone: 'America/New_York' },
  { code: 'LGA', city: 'New York', timezone: 'America/New_York' },
  { code: 'EWR', city: 'Newark', timezone: 'America/New_York' },
  { code: 'BOS', city: 'Boston', timezone: 'America/New_York' },
  { code: 'PHL', city: 'Philadelphia', timezone: 'America/New_York' },
  { code: 'MIA', city: 'Miami', timezone: 'America/New_York' },
  { code: 'DTW', city: 'Detroit', timezone: 'America/New_York' },
  { code: 'ORD', city: 'Chicago', timezone: 'America/Chicago' },
  { code: 'DFW', city: 'Dallas', timezone: 'America/Chicago' },
  { code: 'IAH', city: 'Houston', timezone: 'America/Chicago' },
  { code: 'AUS', city: 'Austin', timezone: 'America/Chicago' },
  { code: 'MSP', city: 'Minneapolis', timezone: 'America/Chicago' },
  { code: 'DEN', city: 'Denver', timezone: 'America/Denver' },
  { code: 'PHX', city: 'Phoenix', timezone: 'America/Phoenix' },
  { code: 'LAX', city: 'Los Angeles', timezone: 'America/Los_Angeles' },
  { code: 'SFO', city: 'San Francisco', timezone: 'America/Los_Angeles' },
  { code: 'SAN', city: 'San Diego', timezone: 'America/Los_Angeles' },
  { code: 'SEA', city: 'Seattle', timezone: 'America/Los_Angeles' },
  { code: 'LAS', city: 'Las Vegas', timezone: 'America/Los_Angeles' },
  { code: 'HNL', city: 'Honolulu', timezone: 'Pacific/Honolulu' },
  { code: 'ANC', city: 'Anchorage', timezone: 'America/Anchorage' },
  { code: 'YYZ', city: 'Toronto', timezone: 'America/Toronto' },
  { code: 'YVR', city: 'Vancouver', timezone: 'America/Vancouver' },
  { code: 'MEX', city: 'Mexico City', timezone: 'America/Mexico_City' },
  { code: 'LHR', city: 'London', timezone: 'Europe/London' },
  { code: 'CDG', city: 'Paris', timezone: 'Europe/Paris' },
  { code: 'FRA', city: 'Frankfurt', timezone: 'Europe/Berlin' },
  { code: 'MAD', city: 'Madrid', timezone: 'Europe/Madrid' },
  { code: 'FCO', city: 'Rome', timezone: 'Europe/Rome' },
  { code: 'AMS', city: 'Amsterdam', timezone: 'Europe/Amsterdam' },
  { code: 'ZRH', city: 'Zurich', timezone: 'Europe/Zurich' },
  { code: 'CPH', city: 'Copenhagen', timezone: 'Europe/Copenhagen' },
  { code: 'IST', city: 'Istanbul', timezone: 'Europe/Istanbul' },
  { code: 'DXB', city: 'Dubai', timezone: 'Asia/Dubai' },
  { code: 'AUH', city: 'Abu Dhabi', timezone: 'Asia/Dubai' },
  { code: 'DOH', city: 'Doha', timezone: 'Asia/Qatar' },
  { code: 'JED', city: 'Jeddah', timezone: 'Asia/Riyadh' },
  { code: 'SIN', city: 'Singapore', timezone: 'Asia/Singapore' },
  { code: 'HKG', city: 'Hong Kong', timezone: 'Asia/Hong_Kong' },
  { code: 'NRT', city: 'Tokyo', timezone: 'Asia/Tokyo' },
  { code: 'HND', city: 'Tokyo', timezone: 'Asia/Tokyo' },
  { code: 'ICN', city: 'Seoul', timezone: 'Asia/Seoul' },
  { code: 'PVG', city: 'Shanghai', timezone: 'Asia/Shanghai' },
  { code: 'TPE', city: 'Taipei', timezone: 'Asia/Taipei' },
  { code: 'BKK', city: 'Bangkok', timezone: 'Asia/Bangkok' },
  { code: 'KUL', city: 'Kuala Lumpur', timezone: 'Asia/Kuala_Lumpur' },
  { code: 'CGK', city: 'Jakarta', timezone: 'Asia/Jakarta' },
  { code: 'DEL', city: 'Delhi', timezone: 'Asia/Kolkata' },
  { code: 'BOM', city: 'Mumbai', timezone: 'Asia/Kolkata' },
  { code: 'SGN', city: 'Ho Chi Minh City', timezone: 'Asia/Ho_Chi_Minh' },
  { code: 'HAN', city: 'Hanoi', timezone: 'Asia/Ho_Chi_Minh' },
  { code: 'DAD', city: 'Da Nang', timezone: 'Asia/Ho_Chi_Minh' },
  { code: 'CXR', city: 'Nha Trang (Cam Ranh)', timezone: 'Asia/Ho_Chi_Minh' },
  { code: 'HUI', city: 'Hue', timezone: 'Asia/Ho_Chi_Minh' },
  { code: 'PQC', city: 'Phu Quoc', timezone: 'Asia/Ho_Chi_Minh' },
  { code: 'VCA', city: 'Can Tho', timezone: 'Asia/Ho_Chi_Minh' },
  { code: 'SYD', city: 'Sydney', timezone: 'Australia/Sydney' },
  { code: 'MEL', city: 'Melbourne', timezone: 'Australia/Melbourne' },
  { code: 'AKL', city: 'Auckland', timezone: 'Pacific/Auckland' }
]

// Matches an airline/carrier's PNG logo, if the user has saved one —
// see the folder/naming instructions given in chat. Slugified so
// "Vietnam Airlines" -> "vietnam-airlines.png"; falls back to the
// existing colored mode icon automatically if no matching file exists
// (or none was ever saved), via the <img onError> in CarrierBadge
// below. Uses BASE_URL like the rest of the app (see main.tsx,
// TripView.tsx) so this also resolves correctly on GitHub Pages'
// /hanhs-wanderlog/ subpath, not just localhost.
interface Segment {
  distanceText: string
  durationText: string
}

const TIME_SELECT_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const TIME_SELECT_MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

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

export default function ItineraryView({ tripId, trip }: Props) {
  const [days, setDays] = useState<ItineraryDay[]>([])
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null)
  const [pins, setPins] = useState<Pin[]>([])
  const [stops, setStops] = useState<StopWithPin[]>([])
  const [allTravelLegs, setAllTravelLegs] = useState<TravelLeg[]>([])
  const [legForm, setLegForm] = useState<LegFormState | null>(null)
  const [savingLeg, setSavingLeg] = useState(false)
  const [editingStop, setEditingStop] = useState<StopWithPin | null>(null)
  const [savingStop, setSavingStop] = useState(false)
  const [loadingDays, setLoadingDays] = useState(true)
  const [addingDay, setAddingDay] = useState(false)
  const [deletingDayId, setDeletingDayId] = useState<string | null>(null)
  const [deletingDayBusy, setDeletingDayBusy] = useState(false)
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

  // Split mouse/touch behavior instead of one PointerSensor for both —
  // a single small `distance` threshold works fine for a mouse (no
  // scrolling risk), but on a touchscreen a normal scroll swipe easily
  // moves more than a few px before the browser recognizes it as a
  // scroll, so the same threshold kept hijacking scroll gestures into
  // accidental block drags. TouchSensor's `delay` requires a genuine
  // one-second press-and-hold before a drag starts (a quick swipe
  // never triggers it), which is the standard "hold to drag"
  // convention on mobile — `tolerance` allows a little finger wobble
  // during that hold without canceling it. Flight/travel-leg blocks
  // don't use this sensor at all anymore (see TimelineLegBlock) — only
  // pool chips and pin-stop blocks are still drag-repositionable.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 1000, tolerance: 8 } })
  )

  useEffect(() => {
    loadDays()
    loadPins()
    // trip.start_date/end_date included deliberately (not just tripId)
    // so editing the trip's dates while already on this tab re-runs
    // loadDays() and picks up any newly-in-range dates immediately,
    // rather than only taking effect on the next full remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, trip.start_date, trip.end_date])

  useEffect(() => {
    setLegForm(null)
    setEditingStop(null)
    setShowMapPopup(false)
    if (!selectedDayId) {
      setStops([])
      return
    }
    loadStops(selectedDayId)
    // Reset scroll to the 7am default whenever the selected day changes.
    requestAnimationFrame(() => {
      timelineWrapperRef.current?.scrollTo({ top: SCROLL_TO_HOUR * HOUR_PX })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayId])

  useEffect(() => {
    // The container div this effect needs doesn't exist yet while
    // loadingDays is true — the component's early return above (the
    // "loading itinerary…" state) renders only a <p>, not the real
    // JSX tree with <div ref={miniMapContainer}>. With an empty
    // dependency array this effect would only ever get ONE attempt,
    // during that loading render, always find the ref null, and never
    // fire again once the real container actually mounts — which is
    // why the mini map was reliably blank on every load, not just
    // sometimes. Re-running once loadingDays flips to false gives it
    // a second, now-valid attempt.
    if (loadingDays) return
    loadGoogleMaps().then(() => {
      if (!miniMapContainer.current || miniMapRef.current) return
      const map = new google.maps.Map(miniMapContainer.current, {
        center: { lat: 20, lng: 0 },
        zoom: 2,
        disableDefaultUI: true,
        gestureHandling: 'greedy'
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
  }, [loadingDays])

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

    let finalDays = data ?? []

    // Covers both "brand new trip, generate every day" AND "trip's
    // dates got edited after days already existed" (e.g. the end date
    // moved out, or the start date moved earlier) — syncDaysToTripDateRange
    // finds whatever dates in the trip's range aren't represented yet
    // and adds them, so the day tabs stay in sync with the trip's
    // actual dates rather than only ever generating once at creation.
    if (trip.start_date && trip.end_date) {
      const changed = await syncDaysToTripDateRange(finalDays, trip.start_date, trip.end_date)
      if (changed) {
        const { data: refreshed } = await supabase
          .from('itinerary_days')
          .select('*')
          .eq('trip_id', tripId)
          .order('day_number')
        finalDays = refreshed ?? finalDays
      }
    }

    setDays(finalDays)
    setSelectedDayId(prev => prev ?? finalDays[0]?.id ?? null)
    loadAllTravelLegs(finalDays.map(d => d.id))
    setLoadingDays(false)
  }

  // Adds any date in [startDate, endDate] that isn't already
  // represented by an existing itinerary_day, and renumbers day_number
  // so the dated days stay in chronological order (with any manual,
  // dateless days pushed after them, keeping their own relative
  // order) — needed for both "brand new trip" (no dated days yet, so
  // every date in range is "missing") and "trip's date range changed
  // after days already existed" (only the newly-added dates are
  // missing). Renumbering goes through a temporary high offset first
  // (the tempOffset step below) specifically to avoid transiently
  // colliding with the table's unique(trip_id, day_number) constraint
  // while numbers are being reassigned — Postgres checks uniqueness
  // per statement, not deferred, so updating straight to final numbers
  // in one pass can collide with another row's current number.
  // Returns whether anything actually changed, so the caller knows
  // whether to re-fetch.
  async function syncDaysToTripDateRange(existingDays: ItineraryDay[], startDate: string, endDate: string): Promise<boolean> {
    const fullRange = eachDateInRange(startDate, endDate)
    const datedDays = existingDays.filter(d => d.date)
    const manualDays = existingDays.filter(d => !d.date)
    const existingDateSet = new Set(datedDays.map(d => d.date))
    const missingDates = fullRange.filter(d => !existingDateSet.has(d))
    if (missingDates.length === 0) return false

    const combinedDated = [
      ...datedDays.map(d => ({ id: d.id as string | null, date: d.date! })),
      ...missingDates.map(date => ({ id: null as string | null, date }))
    ].sort((a, b) => a.date.localeCompare(b.date))

    const tempOffset = 10000
    for (const d of existingDays) {
      await supabase.from('itinerary_days').update({ day_number: d.day_number + tempOffset }).eq('id', d.id)
    }

    let dayNum = 1
    for (const entry of combinedDated) {
      if (entry.id) {
        await supabase.from('itinerary_days').update({ day_number: dayNum }).eq('id', entry.id)
      } else {
        await supabase.from('itinerary_days').insert({ trip_id: tripId, day_number: dayNum, date: entry.date })
      }
      dayNum++
    }

    const sortedManual = [...manualDays].sort((a, b) => a.day_number - b.day_number)
    for (const d of sortedManual) {
      await supabase.from('itinerary_days').update({ day_number: dayNum }).eq('id', d.id)
      dayNum++
    }

    return true
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
    loadAllTravelLegs([...days.map(d => d.id), data.id])
  }

  // A single delete on itinerary_days — the schema's on-delete-cascade
  // FKs take care of that day's stops and travel legs automatically,
  // same pattern as trip deletion. Worth knowing: if the deleted day
  // has a real date that still falls inside the trip's start/end
  // range, and the trip's dates get edited again later, that date
  // will be treated as "missing" by syncDaysToTripDateRange and
  // recreated — deleting a day doesn't shrink the trip's own date
  // range, there's no way to represent "skip this one date" in a
  // simple start/end range. Not an issue unless the trip's dates get
  // re-edited after the delete.
  async function confirmDeleteDay() {
    if (!deletingDayId) return
    setDeletingDayBusy(true)
    const { error } = await supabase.from('itinerary_days').delete().eq('id', deletingDayId)
    setDeletingDayBusy(false)
    if (error) {
      console.error('Failed to delete day', error)
      return
    }
    const remaining = days.filter(d => d.id !== deletingDayId)
    setDays(remaining)
    if (selectedDayId === deletingDayId) {
      setSelectedDayId(remaining[0]?.id ?? null)
    }
    setDeletingDayId(null)
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

  async function loadAllTravelLegs(dayIds: string[]) {
    if (dayIds.length === 0) {
      setAllTravelLegs([])
      return
    }
    const { data, error } = await supabase
      .from('travel_legs')
      .select('*')
      .in('itinerary_day_id', dayIds)

    if (error) {
      console.error('Failed to load travel legs', error)
      return
    }
    setAllTravelLegs(data ?? [])
  }

  // Refetches every leg across the whole trip (not just the selected
  // day) — necessary because editing a leg on one day can change which
  // OTHER day it shows a continuation block on (see continuationLegs
  // below), so any single-day cache would go stale the moment a leg's
  // to_date changes.
  function refreshTravelLegs() {
    loadAllTravelLegs(days.map(d => d.id))
  }

  function startAddLeg() {
    const day = days.find(d => d.id === selectedDayId)
    setLegForm({
      mode: 'flight',
      title: '',
      carrier: '',
      reference: '',
      fromLocation: '',
      fromDate: day?.date ?? '',
      fromTime: '',
      fromTimezone: '',
      toLocation: '',
      toDate: day?.date ?? '',
      toTime: '',
      toTimezone: ''
    })
  }

  function startEditLeg(leg: TravelLeg) {
    setLegForm({
      id: leg.id,
      mode: leg.mode,
      title: leg.title ?? '',
      carrier: leg.carrier ?? '',
      reference: leg.reference ?? '',
      fromLocation: leg.from_location,
      fromDate: leg.from_date ?? '',
      fromTime: leg.from_time ?? '',
      fromTimezone: leg.from_timezone ?? '',
      toLocation: leg.to_location,
      toDate: leg.to_date ?? '',
      toTime: leg.to_time ?? '',
      toTimezone: leg.to_timezone ?? ''
    })
  }

  async function saveLeg() {
    if (!legForm || !selectedDayId) return
    if (!legForm.fromLocation.trim() || !legForm.toLocation.trim()) return

    setSavingLeg(true)
    const payload = {
      itinerary_day_id: selectedDayId,
      mode: legForm.mode,
      title: legForm.title.trim() || null,
      carrier: legForm.carrier.trim() || null,
      reference: legForm.reference.trim() || null,
      from_location: legForm.fromLocation.trim(),
      from_date: legForm.fromDate || null,
      from_time: legForm.fromTime || null,
      from_timezone: legForm.fromTimezone || null,
      to_location: legForm.toLocation.trim(),
      to_date: legForm.toDate || null,
      to_time: legForm.toTime || null,
      to_timezone: legForm.toTimezone || null
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
    refreshTravelLegs()
  }

  async function deleteLeg(legId: string) {
    if (!selectedDayId) return
    const { error } = await supabase.from('travel_legs').delete().eq('id', legId)
    if (error) {
      console.error('Failed to delete travel leg', error)
      return
    }
    setLegForm(null)
    refreshTravelLegs()
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

  async function saveStopTimes(stopId: string, startTime: string, endTime: string, notes: string) {
    setSavingStop(true)
    // Notes live on the stop, not the pin (itinerary_stops.notes,
    // migration 012) — so the same pin scheduled on two different
    // days (e.g. HND on departure and return) can carry two
    // independent notes instead of one shared note that the later
    // edit overwrites.
    const { error: stopError } = await supabase
      .from('itinerary_stops')
      .update({ start_time: startTime || null, end_time: endTime || null, notes: notes.trim() || null })
      .eq('id', stopId)
    setSavingStop(false)
    if (stopError) {
      console.error('Failed to update stop', stopError)
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
    }
    // No 'tleg-' branch — travel-leg blocks aren't draggable anymore,
    // see TimelineLegBlock.
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
      const badgeColor = pinBadgeColor(stop.pin.category, stop.pin.icon)
      const marker = new google.maps.Marker({
        position: { lat: stop.pin.lat, lng: stop.pin.lng },
        map,
        label: { text: String(i + 1), color: '#FFFFFF', fontSize: '11px', fontWeight: '600' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: badgeColor,
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
  const selectedDay = useMemo(() => days.find(d => d.id === selectedDayId) ?? null, [days, selectedDayId])
  // This day's own legs (it departed here) — used for the header chips,
  // the "add travel" flow, and normal timeline blocks.
  const travelLegs = useMemo(
    () => allTravelLegs.filter(l => l.itinerary_day_id === selectedDayId),
    [allTravelLegs, selectedDayId]
  )
  // Legs that departed on an EARLIER day but land on this one — the
  // actual fix for "show the flight extended into tomorrow": these
  // render as a separate continuation block from 00:00 to the arrival
  // time, regardless of which day's itinerary_day_id they belong to.
  const continuationLegs = useMemo(() => {
    if (!selectedDay?.date) return []
    return allTravelLegs.filter(l => l.to_date === selectedDay.date && l.from_date && l.from_date !== l.to_date)
  }, [allTravelLegs, selectedDay])
  const timedLegs = useMemo(
    () =>
      [...travelLegs]
        .filter(l => l.from_time != null)
        .sort((a, b) => (timeToMinutes(a.from_time) ?? 0) - (timeToMinutes(b.from_time) ?? 0)),
    [travelLegs]
  )
  // Card list above the timeline — always earliest-departure first, not
  // insertion/order_index order. Legs without a departure time yet
  // (still being filled in) sort to the end, after every timed one,
  // rather than being excluded like timedLegs above.
  const sortedTravelLegs = useMemo(
    () =>
      [...travelLegs].sort((a, b) => {
        const aMin = timeToMinutes(a.from_time)
        const bMin = timeToMinutes(b.from_time)
        if (aMin == null && bMin == null) return 0
        if (aMin == null) return 1
        if (bMin == null) return -1
        return aMin - bMin
      }),
    [travelLegs]
  )
  // Side-by-side columns for overlapping legs (e.g. two family units'
  // flights around the same time) — computed once across BOTH normal
  // and continuation blocks together, since a continuation block can
  // overlap a same-day departure just as easily as two normal legs
  // can overlap each other.
  const legColumnLayout = useMemo(() => {
    const items = [
      ...continuationLegs.map(l => ({ id: l.id, ...continuationBlockGeometry(l) })),
      ...timedLegs.map(l => ({ id: l.id, ...legBlockGeometry(l) }))
    ]
    return computeColumnLayout(items)
  }, [continuationLegs, timedLegs])

  // Same idea for overlapping pin stops (e.g. Shibuya Crossing and a
  // rooftop bar scheduled at the same time) — a separate layout from
  // legs above, since stops and legs are visually distinct block types
  // that wouldn't normally coincide in a well-planned itinerary; no
  // hard cap on how many columns (the user's "up to 3" was the example
  // given, not a limit to enforce — the algorithm splits however many
  // genuinely overlap, the same way it already does for legs).
  const stopColumnLayout = useMemo(
    () => computeColumnLayout(timedStops.map(s => ({ id: s.id, ...stopBlockGeometry(s) }))),
    [timedStops]
  )

  const activePin = activeDragId?.startsWith('pool-') ? pins.find(p => p.id === activeDragId.slice(5)) : undefined
  const activeStop = activeDragId?.startsWith('tstop-')
    ? stops.find(s => s.id === activeDragId.slice(6))
    : undefined
  // No activeLeg — travel-leg blocks aren't draggable anymore, so
  // activeDragId can never actually start with 'tleg-'.

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
              <span
                className={styles.dayTabDelete}
                role="button"
                tabIndex={0}
                title="delete day"
                aria-label={`delete day ${day.day_number}`}
                onClick={e => {
                  e.stopPropagation()
                  setDeletingDayId(day.id)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    setDeletingDayId(day.id)
                  }
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button className={styles.addDayButton} onClick={addManualDay} disabled={addingDay}>
            {addingDay ? '…' : '+ add day'}
          </button>
        </div>

        {deletingDayId && (
          <div className={styles.popupBackdrop} onClick={() => setDeletingDayId(null)}>
            <div className={styles.popupCard} onClick={e => e.stopPropagation()}>
              <p className={styles.deleteWarning}>
                Delete this day? Everything scheduled on it — stops and flights included — goes with it. This can't
                be undone.
              </p>
              <div className={styles.travelFormActions}>
                <button className={styles.travelFormDelete} onClick={confirmDeleteDay} disabled={deletingDayBusy}>
                  {deletingDayBusy ? '…' : 'delete day'}
                </button>
                <button className={styles.travelFormCancel} onClick={() => setDeletingDayId(null)} disabled={deletingDayBusy}>
                  cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {days.length === 0 && (
          <p className={styles.hint}>no days yet — add one above to start building the itinerary.</p>
        )}

        {days.length > 0 && (
          <div className={styles.dayContent}>
            <div className={styles.travelArea}>
              <p className={styles.travelSectionTitle}>Travel</p>

              <div className={styles.travelHeader}>
                <button type="button" className={styles.addTravelButton} onClick={startAddLeg}>
                  + add travel
                </button>
                <button type="button" className={styles.mapToggleButton} onClick={() => setShowMapPopup(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 20l-5-2V6l5 2 6-2 5 2v12l-5-2-6 2z" />
                    <line x1="9" y1="8" x2="9" y2="20" />
                    <line x1="15" y1="6" x2="15" y2="18" />
                  </svg>
                  map
                </button>
              </div>

              {travelLegs.length > 0 && (
                <div className={timelineStyles.travelCardList}>
                  {sortedTravelLegs.map(leg => (
                    <TravelCardFull key={leg.id} leg={leg} onEdit={() => startEditLeg(leg)} />
                  ))}
                </div>
              )}
            </div>

            <TimelineZone
              className={styles.timelineGridArea}
              scrollRef={timelineWrapperRef}
              timedStops={timedStops}
              stopColumnLayout={stopColumnLayout}
              timedLegs={timedLegs}
              continuationLegs={continuationLegs}
              legColumnLayout={legColumnLayout}
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
        )}
      </div>

      <DragOverlay>
        {activePin && (
          <div className={timelineStyles.poolChip}>
            <span
              className={timelineStyles.poolChipDot}
              style={{ backgroundColor: pinBadgeColor(activePin.category, activePin.icon) }}
            />
            <span>{activePin.name}</span>
          </div>
        )}
        {activeStop && (
          <div className={timelineStyles.dragPreviewBlock} style={{ backgroundColor: pinBadgeColor(activeStop.pin.category, activeStop.pin.icon) }}>
            {activeStop.pin.name}
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
        // Session 25: click-outside-closes was silently discarding
        // whatever the user had typed — confirmed with the user this
        // should require an explicit Cancel instead. No onClick here
        // (unlike the other popupBackdrop uses below, which the user
        // did NOT ask to change) — the form's own "cancel" button
        // (and Save) are now the only ways to close this one.
        <div className={styles.popupBackdrop}>
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

// Native <input type="time"> follows OS/browser locale for its picker
// UI — the lang="en-GB" trick to force 24-hour is unreliable in
// practice (doesn't hold on every browser), so this is a plain pair of
// HH/MM <select>s instead: always renders 24-hour, everywhere, no
// locale dependency. value/onChange work with the same "HH:MM" string
// (or "") used throughout — a real <input type="time">'s value shape.
function TimeSelect24({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [h, m] = value ? value.split(':') : ['', '']

  return (
    <div className={styles.timeSelectGroup}>
      <select
        className={styles.timeSelectPart}
        value={h}
        onChange={e => onChange(e.target.value ? `${e.target.value}:${m || '00'}` : '')}
      >
        <option value="">--</option>
        {TIME_SELECT_HOURS.map(hh => (
          <option key={hh} value={hh}>
            {hh}
          </option>
        ))}
      </select>
      <span className={styles.timeSelectColon}>:</span>
      <select
        className={styles.timeSelectPart}
        value={m}
        onChange={e => onChange(e.target.value ? `${h || '00'}:${e.target.value}` : '')}
      >
        <option value="">--</option>
        {TIME_SELECT_MINUTES.map(mm => (
          <option key={mm} value={mm}>
            {mm}
          </option>
        ))}
      </select>
    </div>
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

      <input
        className={styles.travelFormInput}
        placeholder="title (e.g. San Francisco to New York)"
        value={form.title}
        onChange={e => onChange({ ...form, title: e.target.value })}
      />

      <div className={styles.travelFormRow}>
        {form.mode === 'flight' ? (
          <AirlineCarrierInput value={form.carrier} onChange={carrier => onChange({ ...form, carrier })} />
        ) : (
          <input
            className={styles.travelFormInput}
            placeholder="carrier (e.g. Amtrak, Greyhound)"
            value={form.carrier}
            onChange={e => onChange({ ...form, carrier: e.target.value })}
          />
        )}
        <input
          className={styles.travelFormInput}
          placeholder="number (e.g. DL 383)"
          value={form.reference}
          onChange={e => onChange({ ...form, reference: e.target.value })}
        />
      </div>

      <div className={styles.travelFormRow}>
        {form.mode === 'flight' ? (
          <AirportInput
            value={form.fromLocation}
            onSelect={a => onChange({ ...form, fromLocation: `${a.city} / ${a.code}`, fromTimezone: a.timezone })}
            placeholder="from (search code or city, e.g. AUS)"
            autoFocus
          />
        ) : (
          <input
            className={styles.travelFormInput}
            placeholder="from (e.g. San Francisco)"
            value={form.fromLocation}
            onChange={e => onChange({ ...form, fromLocation: e.target.value })}
            autoFocus
          />
        )}
      </div>
      <div className={styles.travelFormRow}>
        <input
          type="date"
          className={styles.travelFormDateInput}
          value={form.fromDate}
          onChange={e => onChange({ ...form, fromDate: e.target.value })}
        />
        <TimeSelect24 value={form.fromTime} onChange={v => onChange({ ...form, fromTime: v })} />
      </div>

      <div className={styles.travelFormRow}>
        {form.mode === 'flight' ? (
          <AirportInput
            value={form.toLocation}
            onSelect={a => onChange({ ...form, toLocation: `${a.city} / ${a.code}`, toTimezone: a.timezone })}
            placeholder="to (search code or city, e.g. LAX)"
          />
        ) : (
          <input
            className={styles.travelFormInput}
            placeholder="to (e.g. New York)"
            value={form.toLocation}
            onChange={e => onChange({ ...form, toLocation: e.target.value })}
          />
        )}
      </div>
      <div className={styles.travelFormRow}>
        <input
          type="date"
          className={styles.travelFormDateInput}
          value={form.toDate}
          onChange={e => onChange({ ...form, toDate: e.target.value })}
        />
        <TimeSelect24 value={form.toTime} onChange={v => onChange({ ...form, toTime: v })} />
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

// Flight-mode carrier field: filters AIRLINES by substring as you
// type and shows up to 8 matches in a dropdown; picking one fills the
// field with that airline's canonical `value` (see AIRLINES above) so
// it lines up with the logo-lookup convention. Still a free-text
// input underneath — nothing stops typing an airline not on the list.
function AirlineCarrierInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const matches =
    value.trim().length > 0
      ? AIRLINES.filter(a => a.display.toLowerCase().includes(value.trim().toLowerCase())).slice(0, 8)
      : []

  function select(pick: { display: string; value: string }) {
    onChange(pick.value)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => (h + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => (h - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(matches[highlight])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={styles.autocompleteWrap}>
      <input
        className={styles.travelFormInput}
        placeholder="carrier (e.g. Delta)"
        value={value}
        onChange={e => {
          onChange(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 && (
        <div className={styles.autocompleteList}>
          {matches.map((m, i) => (
            <div
              key={m.display}
              className={styles.autocompleteOption}
              data-highlighted={i === highlight}
              // onMouseDown (not onClick) fires before the input's onBlur,
              // so the click actually registers instead of the dropdown
              // closing first.
              onMouseDown={e => {
                e.preventDefault()
                select(m)
              }}
            >
              {m.display}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Searchable IANA timezone picker (e.g. "America/Chicago") — same
// dropdown pattern as AirlineCarrierInput. Matches against the zone
// id with underscores treated as spaces, so typing "los angeles"
// finds "America/Los_Angeles". Each option shows its current UTC
// offset for context, computed only for the short filtered list
// (cheap) rather than for all ~400 zones on every keystroke.
// Flight-mode from/to picker — searches AIRPORTS by code or city, and
// on selection fills the location field as "City / CODE" (matching
// the old free-text placeholder's format) AND the matching timezone
// in one step via onSelect, rather than leaving timezone as a
// separate manual step that's easy to skip or mistype.
function AirportInput({
  value,
  onSelect,
  placeholder,
  autoFocus
}: {
  value: string
  onSelect: (airport: Airport) => void
  placeholder: string
  autoFocus?: boolean
}) {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    setText(value)
  }, [value])

  const query = text.trim().toLowerCase()
  const matches =
    query.length > 0
      ? AIRPORTS.filter(a => a.code.toLowerCase().includes(query) || a.city.toLowerCase().includes(query)).slice(0, 8)
      : []

  function select(airport: Airport) {
    setText(`${airport.city} / ${airport.code}`)
    onSelect(airport)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => (h + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => (h - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(matches[highlight])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={styles.autocompleteWrap}>
      <input
        className={styles.travelFormInput}
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        onChange={e => {
          setText(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 && (
        <div className={styles.autocompleteList}>
          {matches.map((a, i) => (
            <div
              key={a.code}
              className={styles.autocompleteOption}
              data-highlighted={i === highlight}
              onMouseDown={e => {
                e.preventDefault()
                select(a)
              }}
            >
              {a.code} — {a.city}
            </div>
          ))}
        </div>
      )}
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
  onSave: (stopId: string, startTime: string, endTime: string, notes: string) => void
  onRemove: (stopId: string) => void
  onClose: () => void
}) {
  const [start, setStart] = useState(stop.start_time ?? '')
  const [end, setEnd] = useState(stop.end_time ?? '')
  const [notes, setNotes] = useState(stop.notes ?? '')
  const badgeColor = pinBadgeColor(stop.pin.category, stop.pin.icon)

  return (
    <div className={styles.popupBackdrop} onClick={onClose}>
      <div className={styles.popupCard} onClick={e => e.stopPropagation()}>
        <div className={styles.stopEditHeader}>
          <span className={styles.stopEditDot} style={{ backgroundColor: badgeColor }} />
          <p className={styles.stopEditName}>{stop.pin.name}</p>
        </div>
        <div className={styles.travelFormRow}>
          <TimeSelect24 value={start} onChange={setStart} />
          <span className={styles.timeSep}>–</span>
          <TimeSelect24 value={end} onChange={setEnd} />
        </div>
        <textarea
          className={styles.noteTextarea}
          placeholder="e.g. Go up to the upper deck of the adjacent tower to look down at the crossing"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
        />
        <div className={styles.travelFormActions}>
          <button
            type="button"
            className={styles.travelFormSave}
            onClick={() => onSave(stop.id, start, end, notes)}
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
