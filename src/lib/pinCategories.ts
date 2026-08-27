import type { Pin } from '../types'

export type PinCategory = Pin['category']

// Small hand-built line icons (24x24 viewBox, white stroke/fill) — used
// inside the colored circle on each map pin. Kept as inline SVG rather
// than an icon-font dependency, so the marker HTML (built imperatively)
// has no external font/CDN to load.
export const ICON_SVGS: Record<PinCategory, string> = {
  attraction: `<svg width="18" height="18" viewBox="0 0 24 24"><polygon points="12,2 14.9,8.6 22,9.3 16.5,14 18.2,21 12,17.3 5.8,21 7.5,14 2,9.3 9.1,8.6" fill="white"/></svg>`,
  dining: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="3" x2="7" y2="10"/><line x1="5" y1="3" x2="5" y2="8"/><line x1="9" y1="3" x2="9" y2="8"/><line x1="7" y1="10" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/><path d="M15 3c0 4 2 4 2 8"/></svg>`,
  cafe: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z"/><path d="M16 10h1a2 2 0 0 1 0 4h-1"/><line x1="8" y1="3" x2="8" y2="5"/><line x1="11" y1="3" x2="11" y2="5"/></svg>`,
  bakery: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21h10l-1.2-8H8.2L7 21z"/><path d="M8 13c0-3 2-3 2-5s-1-3-1-3 3 0 3 3c0-3 3-3 3 0 0 2-1 3-1 5"/><circle cx="12" cy="9" r="0.8" fill="white" stroke="none"/></svg>`,
  accommodation: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 18v2"/><path d="M21 18v2"/><path d="M3 13V8a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v2"/><path d="M3 13h18"/></svg>`,
  airport: `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V4.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-3 2v1.5l4.5-1 4.5 1V21l-3-2v-4.5l8 2.5z" fill="white"/></svg>`,
  transport: `<svg width="18" height="18" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="10" rx="2" fill="none" stroke="white" stroke-width="2"/><line x1="4" y1="11" x2="20" y2="11" stroke="white" stroke-width="2"/><line x1="9" y1="6" x2="9" y2="11" stroke="white" stroke-width="1.5"/><line x1="14" y1="6" x2="14" y2="11" stroke="white" stroke-width="1.5"/><circle cx="8" cy="18" r="1.6" fill="white"/><circle cx="16" cy="18" r="1.6" fill="white"/></svg>`,
  shopping: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`
}

// Color + label per category, used for the marker badges on the map,
// the category picker in the "add pin" form, and (as of the Itinerary
// tab) the pinned list, day stops, and mini route map.
export const CATEGORIES: { key: PinCategory; label: string; color: string }[] = [
  { key: 'attraction', label: 'Attraction', color: '#FF9900' },
  { key: 'dining', label: 'Dining', color: '#D85A30' },
  { key: 'cafe', label: 'Cafe', color: '#BA7517' },
  { key: 'bakery', label: 'Bakery/Dessert', color: '#D4537E' },
  { key: 'accommodation', label: 'Accommodation', color: '#378ADD' },
  { key: 'airport', label: 'Airport', color: '#7F77DD' },
  { key: 'transport', label: 'Transport', color: '#1D9E75' },
  { key: 'shopping', label: 'Shopping', color: '#639922' }
]

export function categoryConfig(category: PinCategory) {
  return CATEGORIES.find(c => c.key === category) ?? CATEGORIES[0]
}
