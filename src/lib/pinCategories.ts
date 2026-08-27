import type { Pin } from '../types'

export type PinCategory = Pin['category']

// Small hand-built line icons (24x24 viewBox, white stroke/fill) — used
// inside the colored circle on each map pin. Kept as inline SVG rather
// than an icon-font dependency, so the marker HTML (built imperatively)
// has no external font/CDN to load.
export const ICON_SVGS: Record<PinCategory, string> = {
  attraction: `<svg width="13" height="13" viewBox="0 0 24 24"><polygon points="12,2 14.9,8.6 22,9.3 16.5,14 18.2,21 12,17.3 5.8,21 7.5,14 2,9.3 9.1,8.6" fill="white"/></svg>`,
  dining: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="3" x2="7" y2="10"/><line x1="5" y1="3" x2="5" y2="8"/><line x1="9" y1="3" x2="9" y2="8"/><line x1="7" y1="10" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/><path d="M15 3c0 4 2 4 2 8"/></svg>`,
  cafe: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z"/><path d="M16 10h1a2 2 0 0 1 0 4h-1"/><line x1="8" y1="3" x2="8" y2="5"/><line x1="11" y1="3" x2="11" y2="5"/></svg>`,
  bakery: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21h10l-1.2-8H8.2L7 21z"/><path d="M8 13c0-3 2-3 2-5s-1-3-1-3 3 0 3 3c0-3 3-3 3 0 0 2-1 3-1 5"/><circle cx="12" cy="9" r="0.8" fill="white" stroke="none"/></svg>`,
  accommodation: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 18v2"/><path d="M21 18v2"/><path d="M3 13V8a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v2"/><path d="M3 13h18"/></svg>`,
  airport: `<svg width="13" height="13" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V4.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-3 2v1.5l4.5-1 4.5 1V21l-3-2v-4.5l8 2.5z" fill="white"/></svg>`,
  transport: `<svg width="13" height="13" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="10" rx="2" fill="none" stroke="white" stroke-width="2"/><line x1="4" y1="11" x2="20" y2="11" stroke="white" stroke-width="2"/><line x1="9" y1="6" x2="9" y2="11" stroke="white" stroke-width="1.5"/><line x1="14" y1="6" x2="14" y2="11" stroke="white" stroke-width="1.5"/><circle cx="8" cy="18" r="1.6" fill="white"/><circle cx="16" cy="18" r="1.6" fill="white"/></svg>`,
  shopping: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`
}

// Color + label per category, used for the marker badges on the map,
// the category picker in the "add pin" form, and (as of the Itinerary
// tab) the pinned list, day stops, and mini route map. Kept
// alphabetical by label — this single order now also drives category
// grouping in the pinned list (MapView) and the unscheduled pool
// (ItineraryView), so re-sorting this array re-sorts those too.
export const CATEGORIES: { key: PinCategory; label: string; color: string }[] = [
  { key: 'accommodation', label: 'Accommodation', color: '#378ADD' },
  { key: 'airport', label: 'Airport', color: '#7F77DD' },
  { key: 'attraction', label: 'Attraction', color: '#1B2A4A' },
  { key: 'bakery', label: 'Bakery/Dessert', color: '#D4537E' },
  { key: 'cafe', label: 'Cafe', color: '#BA7517' },
  { key: 'dining', label: 'Dining', color: '#D85A30' },
  { key: 'shopping', label: 'Shopping', color: '#639922' },
  { key: 'transport', label: 'Transport', color: '#1D9E75' }
]

export function categoryConfig(category: PinCategory) {
  return CATEGORIES.find(c => c.key === category) ?? CATEGORIES[0]
}

export interface IconVariant {
  key: string
  label: string
  svg: string
}

// Per-category icon variants — a category's first entry is always its
// "general" default (same glyph as ICON_SVGS above, kept in sync
// manually since it's duplicated here for the picker UI). Only
// categories with more than one meaningful option get an entry; a
// category absent from this map has no picker and always uses
// ICON_SVGS[category]. A pin's stored `icon` is the variant `key`
// (e.g. 'church') or null, meaning "use the category default".
export const ICON_VARIANTS: Partial<Record<PinCategory, IconVariant[]>> = {
  attraction: [
    { key: 'general', label: 'General', svg: ICON_SVGS.attraction },
    {
      key: 'church',
      label: 'Church',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M9 4h6"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/></svg>`
    },
    {
      key: 'museum',
      label: 'Museum',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M3 10l9-6 9 6"/></svg>`
    },
    {
      key: 'landmark',
      label: 'Landmark',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6h-6l3-6z"/><path d="M9 8h6l2 6H7l2-6z"/><path d="M6 21V14h12v7"/></svg>`
    },
    {
      key: 'temple',
      label: 'Temple/pagoda',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l4 5H8l4-5z"/><path d="M9 7l5 6H6l3-6z"/><path d="M4 21l4-8h8l4 8z"/></svg>`
    },
    {
      key: 'viewpoint',
      label: 'Viewpoint',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="6" r="2" fill="white" stroke="none"/><path d="M3 20l6-9 4 5 3-4 5 8"/></svg>`
    },
    {
      key: 'park',
      label: 'Park/garden',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><line x1="12" y1="14" x2="12" y2="21"/></svg>`
    },
    {
      key: 'bridge',
      label: 'Bridge',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16c2-4 5-6 9-6s7 2 9 6"/><line x1="5" y1="16" x2="5" y2="21"/><line x1="19" y1="16" x2="19" y2="21"/><line x1="3" y1="21" x2="21" y2="21"/></svg>`
    },
    {
      key: 'music_venue',
      label: 'Music venue',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`
    }
  ],
  dining: [
    { key: 'general', label: 'General', svg: ICON_SVGS.dining },
    {
      key: 'street_food',
      label: 'Street food',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11h16l-2-5H6l-2 5z"/><path d="M6 21V11h12v10"/><circle cx="9" cy="21" r="1" fill="white" stroke="none"/><circle cx="15" cy="21" r="1" fill="white" stroke="none"/></svg>`
    },
    {
      key: 'noodle_pho',
      label: 'Noodle/pho',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16a8 6 0 0 1-16 0z"/><path d="M9 6c0 1-1 1-1 2"/><path d="M13 6c0 1-1 1-1 2"/></svg>`
    },
    {
      key: 'bbq_grill',
      label: 'BBQ/grill',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="8" rx="1"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="8" y1="6" x2="8" y2="10"/><line x1="16" y1="6" x2="16" y2="10"/></svg>`
    },
    {
      key: 'seafood',
      label: 'Seafood',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c4-5 12-5 16 0-4 5-12 5-16 0z"/><circle cx="16" cy="11" r="0.8" fill="white" stroke="none"/><path d="M19 12l3-3M19 12l3 3"/></svg>`
    },
    {
      key: 'fast_food',
      label: 'Fast food',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h16"/><path d="M4 14h16"/><path d="M5 10a7 4 0 0 1 14 0"/><path d="M5 14a7 3 0 0 0 14 0"/></svg>`
    },
    {
      key: 'fine_dining',
      label: 'Fine dining',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l-1 6a3 3 0 0 1-6 0z"/><line x1="12" y1="12" x2="12" y2="19"/><line x1="8" y1="21" x2="16" y2="21"/></svg>`
    },
    {
      key: 'bar_pub',
      label: 'Bar/pub',
      svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h11v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6z"/><path d="M16 8h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/><line x1="5" y1="6" x2="16" y2="6"/></svg>`
    }
  ]
}

// Resolves the actual icon SVG for a pin: its stored variant if it has
// one and the category still recognizes that key, otherwise the
// category's plain default (ICON_SVGS). Pins created before this
// feature (icon = null) fall straight through to the default.
export function pinIconSvg(category: PinCategory, iconKey: string | null): string {
  if (iconKey) {
    const variant = ICON_VARIANTS[category]?.find(v => v.key === iconKey)
    if (variant) return variant.svg
  }
  return ICON_SVGS[category]
}

export interface PinCategoryGroup {
  key: PinCategory
  label: string
  color: string
  pins: Pin[]
}

// Groups a list of pins by category (in CATEGORIES' order — currently
// alphabetical by label) with pins alphabetized by name within each
// group. Categories with no pins in the list are omitted. Shared by
// the Map tab's pinned list and the Itinerary tab's unscheduled pool
// so both group/sort identically.
export function groupPinsByCategory(pins: Pin[]): PinCategoryGroup[] {
  return CATEGORIES.map(cat => ({
    ...cat,
    pins: pins
      .filter(p => p.category === cat.key)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  })).filter(group => group.pins.length > 0)
}
