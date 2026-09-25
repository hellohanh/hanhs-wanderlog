// Shared timeline geometry, column-overlap layout, and travel-leg time
// math (Session 32/33) — extracted from ItineraryView.tsx so the same
// logic drives both the full Itinerary tab AND the new read/write
// itinerary panel on the map page (MapView.tsx), rather than two
// copies that could quietly drift apart. Pure functions and constants
// only; nothing here depends on React or component state.
import type { TravelLeg, TravelMode as LegMode } from '../types'

// --- Time <-> minutes-of-day helpers, used throughout the timeline ---
export const HOUR_PX = 60
export const SNAP_MIN = 15
export const DEFAULT_DURATION_MIN = 60
export const MIN_BLOCK_PX = 22
// SCROLL_TO_HOUR is the top of the default visible window; paired with
// .timelineScroll's max-height (18 hours' worth, 1080px) in the CSS,
// this makes the default view exactly 06:00-00:00 (midnight) — change
// one, change the other.
export const SCROLL_TO_HOUR = 6
export const DAY_MINUTES = 24 * 60
export const MIN_LEG_CARD_PX = 108

export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

export function minutesToTime(m: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES - 1, m))
  const h = Math.floor(clamped / 60)
  const mm = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}:00`
}

export function snapMinutes(m: number): number {
  const snapped = Math.round(m / SNAP_MIN) * SNAP_MIN
  return Math.max(0, Math.min(DAY_MINUTES - SNAP_MIN, snapped))
}

export function formatDayDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// "Austin / AUS" -> "AUSTIN (AUS)" for the times row. Falls back to a
// plain uppercase of whatever's there for locations that don't match
// the "City / CODE" shape (free-text train/bus/personal entries, or
// anything typed by hand instead of picked from AirportInput).
export function formatLocationLabel(location: string): string {
  const match = location.match(/^(.+?)\s*\/\s*(.+)$/)
  if (match) return `${match[1].trim().toUpperCase()} (${match[2].trim().toUpperCase()})`
  return location.toUpperCase()
}

export function slugifyCarrier(carrier: string): string {
  return carrier
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents (é -> e, ñ -> n, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function carrierLogoPath(carrier: string): string {
  return `${import.meta.env.BASE_URL}airlines/${slugifyCarrier(carrier)}.png`
}

// Split duration for the big "8h / 15 MIN" two-line display on a
// travel card. When BOTH from_timezone and to_timezone are set, this
// converts each wall-clock date+time to a real UTC instant (DST-aware,
// via Intl) before diffing — a same-clock-frame subtraction is simply
// wrong whenever departure and arrival are in different timezones
// (e.g. Austin CST -> Los Angeles PST reads as 1h46m on the clock but
// is really 3h46m elapsed). If either timezone is missing, falls back
// to the old naive date+time diff (both sides parsed the same way, so
// still self-consistent — just not timezone-corrected) so legs
// created before this feature keep working with no backfill needed.
export function legDurationParts(leg: TravelLeg): { hours: number; minutes: number } | null {
  if (!leg.from_time || !leg.to_time) return null
  const fromDate = leg.from_date ?? leg.to_date ?? '2000-01-01'
  const toDate = leg.to_date ?? leg.from_date ?? '2000-01-01'

  let startMs: number | null
  let endMs: number | null
  if (leg.from_timezone && leg.to_timezone) {
    startMs = zonedWallTimeToUtcMs(fromDate, leg.from_time, leg.from_timezone)
    endMs = zonedWallTimeToUtcMs(toDate, leg.to_time, leg.to_timezone)
  } else {
    startMs = Date.parse(`${fromDate}T${leg.from_time}`)
    endMs = Date.parse(`${toDate}T${leg.to_time}`)
  }

  if (startMs == null || endMs == null || Number.isNaN(startMs) || Number.isNaN(endMs)) return null
  const totalMinutes = Math.round((endMs - startMs) / 60000)
  if (totalMinutes <= 0) return null
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
}

// The UTC offset (in minutes) a given IANA timezone actually has at a
// specific instant — computed via Intl rather than a static table, so
// it's correct across DST changes automatically.
export function utcOffsetMinutesAt(instant: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(instant)
    const map: Record<string, string> = {}
    parts.forEach(p => {
      if (p.type !== 'literal') map[p.type] = p.value
    })
    let hour = parseInt(map.hour, 10)
    if (hour === 24) hour = 0 // some engines report midnight as "24" with hour12:false
    const asUtcMs = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second))
    return (asUtcMs - instant.getTime()) / 60000
  } catch {
    return null
  }
}

// Normalizes a time value to plain "HH:MM" — Postgres returns stored
// times as "HH:MM:SS", but values fresh out of TimeSelect24 (before a
// save+reload round-trip) are just "HH:MM". Every function below that
// builds a date string from a time value goes through this first, so
// it doesn't matter which shape it's handed.
export function normalizeTime(timeStr: string): string {
  return timeStr.slice(0, 5)
}

// Converts a wall-clock "this is what the clock reads in timeZone" to
// the real UTC instant it represents (ms since epoch). One correction
// pass — accurate for virtually all real scheduling; only the exact
// hour of a DST transition could be off by the transition size, which
// is not worth a second pass for a personal trip-planning app.
export function zonedWallTimeToUtcMs(dateStr: string, timeStr: string, timeZone: string): number | null {
  const naiveUtcMs = Date.parse(`${dateStr}T${normalizeTime(timeStr)}:00Z`)
  if (Number.isNaN(naiveUtcMs)) return null
  const offsetMin = utcOffsetMinutesAt(new Date(naiveUtcMs), timeZone)
  if (offsetMin == null) return null
  return naiveUtcMs - offsetMin * 60000
}

// Short abbreviation ("CST", "PST") for display next to a time on the
// card — best-effort, falls back to the bare offset if the engine
// doesn't have a short name for that zone/date.
export function timezoneAbbreviation(timeZone: string, dateStr: string, timeStr: string): string | null {
  try {
    const instant = new Date(`${dateStr}T${normalizeTime(timeStr)}:00`)
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(instant)
    return parts.find(p => p.type === 'timeZoneName')?.value ?? null
  } catch {
    return null
  }
}

// Whole-day offset between arrival and departure dates (0 for a
// same-day leg, 1 for "arrives the next day", etc.) — shown as a
// small "+N" badge next to the arrival time, the same convention most
// flight-tracker UIs use for overnight/international legs.
export function legDayOffset(leg: TravelLeg): number | null {
  if (!leg.from_date || !leg.to_date) return null
  const from = new Date(`${leg.from_date}T00:00:00`)
  const to = new Date(`${leg.to_date}T00:00:00`)
  const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
  return days > 0 ? days : null
}

// Shared top/height math for a normal (departure-day) leg block and a
// continuation block — pulled out so the column-overlap layout below
// computes intervals identically to what each block actually renders,
// rather than a second, potentially-diverging copy of the same logic.
export function legBlockGeometry(leg: TravelLeg): { top: number; height: number; crossesMidnight: boolean } {
  const start = timeToMinutes(leg.from_time) ?? 0
  const endRaw = timeToMinutes(leg.to_time)
  const dayOffset = legDayOffset(leg)
  const naiveHeightMin = endRaw != null ? endRaw - start : DEFAULT_DURATION_MIN
  const crossesMidnight = naiveHeightMin <= 0 || (dayOffset != null && dayOffset > 0)
  const heightMin = crossesMidnight ? DAY_MINUTES - start : naiveHeightMin
  return { top: (start / 60) * HOUR_PX, height: Math.max(MIN_BLOCK_PX, (heightMin / 60) * HOUR_PX), crossesMidnight }
}

export function continuationBlockGeometry(leg: TravelLeg): { top: number; height: number } {
  const end = timeToMinutes(leg.to_time) ?? DEFAULT_DURATION_MIN
  return { top: 0, height: Math.max(MIN_BLOCK_PX, (end / 60) * HOUR_PX) }
}

export function stopBlockGeometry(stop: { start_time: string | null; end_time: string | null }): { top: number; height: number } {
  const start = timeToMinutes(stop.start_time) ?? 0
  const end = timeToMinutes(stop.end_time)
  const top = (start / 60) * HOUR_PX
  const height = Math.max(MIN_BLOCK_PX, ((end != null ? end - start : DEFAULT_DURATION_MIN) / 60) * HOUR_PX)
  return { top, height }
}

export interface ColumnLayout {
  col: number
  cols: number
}

// Side-by-side layout for overlapping blocks (e.g. two family units'
// flights around the same time, or the boys' phở next to the girls'
// nail-salon trip at 3pm) — groups items into clusters of mutually
// overlapping blocks (by vertical top/height, matching what's actually
// on screen), then greedily assigns each cluster's items to the fewest
// columns such that no two overlapping items share a column — the same
// approach a calendar day-view uses for concurrent events. Items
// outside any overlap get a lone column (full width). No hard cap on
// how many columns — splits into however many genuinely overlap.
export function computeColumnLayout(items: { id: string; top: number; height: number }[]): Map<string, ColumnLayout> {
  const result = new Map<string, ColumnLayout>()
  const sorted = [...items].sort((a, b) => a.top - b.top)

  let cluster: { id: string; top: number; end: number }[] = []
  let clusterEnd = -Infinity

  function flushCluster() {
    if (cluster.length === 0) return
    const colEnds: number[] = []
    const assignments: { id: string; col: number }[] = []
    for (const item of cluster) {
      let placedCol = -1
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= item.top) {
          colEnds[c] = item.end
          placedCol = c
          break
        }
      }
      if (placedCol === -1) {
        colEnds.push(item.end)
        placedCol = colEnds.length - 1
      }
      assignments.push({ id: item.id, col: placedCol })
    }
    const cols = colEnds.length
    assignments.forEach(a => result.set(a.id, { col: a.col, cols }))
    cluster = []
  }

  for (const item of sorted) {
    const end = item.top + item.height
    if (item.top >= clusterEnd) {
      flushCluster()
      clusterEnd = end
    } else {
      clusterEnd = Math.max(clusterEnd, end)
    }
    cluster.push({ id: item.id, top: item.top, end })
  }
  flushCluster()

  return result
}

// Turns a column assignment into the actual left/width CSS for a
// block — splits the space to the right of the hour-label gutter (see
// .timelineBlock's default left: 60px / right: 8px) evenly across
// however many columns its overlap cluster needs, with a small gap
// between them. A lone (non-overlapping) block gets col 0 of 1 —
// numerically the same as the old fixed left/right, just expressed as
// left+width instead. `gutter` lets a narrower host (e.g. the 300px
// map-page panel) use a smaller label gutter than the full Itinerary
// tab's 60px.
export function blockPositionStyle(layout: ColumnLayout | undefined, gutter = 60): { left: string; width: string } {
  const col = layout?.col ?? 0
  const cols = layout?.cols ?? 1
  const gap = 4
  const right = 8
  return {
    left: `calc(${gutter}px + (100% - ${gutter + right}px) * ${col} / ${cols})`,
    width: `calc((100% - ${gutter + right}px) / ${cols} - ${gap}px)`
  }
}

// Icon + color per travel-leg mode, independent of the pin category
// colors (these are a different concept — a day's travel card, not a
// map pin). No live status/tracking here (out of scope, E9) — just the
// mode's look.
export const LEG_MODE_CONFIG: Record<LegMode, { label: string; color: string; svg: string }> = {
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

export const LEG_DIVIDER_ICONS: Record<LegMode, string> = {
  flight: `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V4.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-3 2v1.5l4.5-1 4.5 1V21l-3-2v-4.5l8 2.5z" fill="currentColor"/></svg>`,
  train: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="12" rx="2"/><line x1="5" y1="10" x2="19" y2="10"/><circle cx="8.5" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="18" r="1.3" fill="currentColor" stroke="none"/><line x1="8" y1="18" x2="6" y2="21"/><line x1="16" y1="18" x2="18" y2="21"/></svg>`,
  bus: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="11" rx="2"/><line x1="3" y1="11" x2="21" y2="11"/><line x1="7" y1="6" x2="7" y2="11"/><line x1="17" y1="6" x2="17" y2="11"/><circle cx="7" cy="19" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="19" r="1.4" fill="currentColor" stroke="none"/></svg>`,
  personal: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><circle cx="7.5" cy="17" r="1.4" fill="currentColor" stroke="none"/><circle cx="16.5" cy="17" r="1.4" fill="currentColor" stroke="none"/></svg>`
}

export const EDIT_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`
