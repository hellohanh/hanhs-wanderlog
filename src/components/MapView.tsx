import { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MLMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { supabase } from '../lib/supabaseClient'
import type { Pin } from '../types'
import styles from './MapView.module.css'

interface Props {
  tripId: string
}

interface NominatimResult {
  display_name: string
  lat: string
  lon: string
  name?: string
}

type PinCategory = Pin['category']

interface DraftPin {
  lat: number
  lng: number
  name: string
  category: PinCategory
}

// Small hand-built line icons (24x24 viewBox, white stroke/fill) — used
// inside the colored circle on each map pin. Kept as inline SVG rather
// than an icon-font dependency so the marker HTML (built imperatively
// for MapLibre, not through React) has no external font/CDN to load.
const ICON_SVGS: Record<PinCategory, string> = {
  attraction: `<svg width="18" height="18" viewBox="0 0 24 24"><polygon points="12,2 14.9,8.6 22,9.3 16.5,14 18.2,21 12,17.3 5.8,21 7.5,14 2,9.3 9.1,8.6" fill="white"/></svg>`,
  dining: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="3" x2="7" y2="10"/><line x1="5" y1="3" x2="5" y2="8"/><line x1="9" y1="3" x2="9" y2="8"/><line x1="7" y1="10" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/><path d="M15 3c0 4 2 4 2 8"/></svg>`,
  cafe: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z"/><path d="M16 10h1a2 2 0 0 1 0 4h-1"/><line x1="8" y1="3" x2="8" y2="5"/><line x1="11" y1="3" x2="11" y2="5"/></svg>`,
  bakery: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21h10l-1.2-8H8.2L7 21z"/><path d="M8 13c0-3 2-3 2-5s-1-3-1-3 3 0 3 3c0-3 3-3 3 0 0 2-1 3-1 5"/><circle cx="12" cy="9" r="0.8" fill="white" stroke="none"/></svg>`,
  accommodation: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 18v2"/><path d="M21 18v2"/><path d="M3 13V8a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v2"/><path d="M3 13h18"/></svg>`,
  airport: `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V4.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-3 2v1.5l4.5-1 4.5 1V21l-3-2v-4.5l8 2.5z" fill="white"/></svg>`,
  transport: `<svg width="18" height="18" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="10" rx="2" fill="none" stroke="white" stroke-width="2"/><line x1="4" y1="11" x2="20" y2="11" stroke="white" stroke-width="2"/><line x1="9" y1="6" x2="9" y2="11" stroke="white" stroke-width="1.5"/><line x1="14" y1="6" x2="14" y2="11" stroke="white" stroke-width="1.5"/><circle cx="8" cy="18" r="1.6" fill="white"/><circle cx="16" cy="18" r="1.6" fill="white"/></svg>`,
  shopping: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`
}

// Color + label per category, used for both the marker badges on the
// map and the category picker in the "add pin" form.
const CATEGORIES: { key: PinCategory; label: string; color: string }[] = [
  { key: 'attraction', label: 'Attraction', color: '#FF9900' },
  { key: 'dining', label: 'Dining', color: '#D85A30' },
  { key: 'cafe', label: 'Cafe', color: '#BA7517' },
  { key: 'bakery', label: 'Bakery/Dessert', color: '#D4537E' },
  { key: 'accommodation', label: 'Accommodation', color: '#378ADD' },
  { key: 'airport', label: 'Airport', color: '#7F77DD' },
  { key: 'transport', label: 'Transport', color: '#1D9E75' },
  { key: 'shopping', label: 'Shopping', color: '#639922' }
]

function categoryConfig(category: PinCategory) {
  return CATEGORIES.find(c => c.key === category) ?? CATEGORIES[0]
}

// Free public vector tile style — see SKILL.md E6 for the OSM data source
// decisions (Nominatim/Overpass/OSRM) and Q1 for the open question on
// handling rate limits as usage grows.
const OSM_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export default function MapView({ tripId }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const [pins, setPins] = useState<Pin[]>([])
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null)
  const [draftPin, setDraftPin] = useState<DraftPin | null>(null)
  const [nearbyEats, setNearbyEats] = useState<{ name: string; lat: number; lng: number }[]>([])
  const [loadingEats, setLoadingEats] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: OSM_STYLE,
      center: [0, 20],
      zoom: 2
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Clicking the map opens the draft form instead of saving right
    // away — this is where name + category both get set.
    map.on('click', e => {
      setSelectedPin(null)
      setDraftPin({ lat: e.lngLat.lat, lng: e.lngLat.lng, name: '', category: 'attraction' })
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [tripId])

  useEffect(() => {
    loadPins()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])

  async function loadPins() {
    const { data, error } = await supabase
      .from('pins')
      .select('*')
      .eq('trip_id', tripId)

    if (error) {
      console.error('Failed to load pins', error)
      return
    }
    setPins(data ?? [])
  }

  async function createPin(name: string, lat: number, lng: number, category: PinCategory) {
    const { data: userData } = await supabase.auth.getUser()
    const addedBy = userData.user?.id

    const { error } = await supabase.from('pins').insert({
      trip_id: tripId,
      name,
      category,
      lat,
      lng,
      added_by: addedBy
    })

    if (error) {
      console.error('Failed to add pin', error)
      return
    }

    loadPins()

    const map = mapRef.current
    if (map) {
      map.flyTo({ center: [lng, lat], zoom: 14 })
    }
  }

  async function confirmDraftPin() {
    if (!draftPin || !draftPin.name.trim()) return
    await createPin(draftPin.name.trim(), draftPin.lat, draftPin.lng, draftPin.category)
    setDraftPin(null)
  }

  // Uses the free public Nominatim instance per E6. Triggered only on
  // explicit submit (not per-keystroke) to stay within its usage
  // policy — see Q1 in SKILL.md for the broader open question on
  // handling rate limits as usage grows. Note: Nominatim is a
  // place-name/address geocoder, not an airport-code database — search
  // by name (e.g. "Tan Son Nhat International Airport"), not by code.
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim()) return

    setSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`
      )
      const data = await res.json()
      setSearchResults(data)
    } catch (err) {
      console.error('Nominatim search failed', err)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  function startDraftFromSearchResult(result: NominatimResult) {
    const name = result.name || result.display_name.split(',')[0]
    setSelectedPin(null)
    setDraftPin({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      name,
      category: 'attraction'
    })
    setSearchResults([])
    setSearchQuery('')
  }

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    pins.forEach(pin => {
      const cfg = categoryConfig(pin.category)

      // Teardrop pin: white outer shape (CSS-only, rotated square trick),
      // a solid colored circle inset in the bulb, and a white icon inside
      // that circle, counter-rotated back upright.
      const el = document.createElement('div')
      el.className = styles.pinMarker
      el.title = `${cfg.label}: ${pin.name}`
      el.innerHTML = `
        <span class="${styles.pinOuter}">
          <span class="${styles.pinInner}" style="background:${cfg.color}">
            <span class="${styles.pinIconWrap}">${ICON_SVGS[pin.category]}</span>
          </span>
        </span>
      `

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map)

      el.addEventListener('click', evt => {
        evt.stopPropagation()
        setDraftPin(null)
        setSelectedPin(pin)
      })

      markersRef.current.push(marker)
    })

    if (pins.length > 0) {
      const first = pins[0]
      map.flyTo({ center: [first.lng, first.lat], zoom: 12 })
    }
  }, [pins])

  useEffect(() => {
    if (!selectedPin) {
      setNearbyEats([])
      return
    }
    loadNearbyEats(selectedPin)
  }, [selectedPin])

  // Uses the free public Overpass API instance per E6. Q1 (open in
  // SKILL.md) tracks how to handle rate limits if usage ever grows
  // beyond light personal/family use.
  async function loadNearbyEats(pin: Pin) {
    setLoadingEats(true)
    const radius = 600
    const query = `
      [out:json][timeout:15];
      node["amenity"="restaurant"](around:${radius},${pin.lat},${pin.lng});
      out body 8;
    `
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query
      })
      const json = await res.json()
      const results = (json.elements ?? []).map((el: any) => ({
        name: el.tags?.name ?? 'unnamed restaurant',
        lat: el.lat,
        lng: el.lon
      }))
      setNearbyEats(results)
    } catch (err) {
      console.error('Overpass lookup failed', err)
      setNearbyEats([])
    } finally {
      setLoadingEats(false)
    }
  }

  return (
    <div>
      <div className={styles.searchBar}>
        <form className={styles.searchForm} onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="search by name or address (not airport codes)"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button type="submit" disabled={searching}>
            {searching ? 'searching…' : 'search'}
          </button>
        </form>

        {searchResults.length > 0 && (
          <div className={styles.searchResults}>
            {searchResults.map((r, i) => (
              <div key={i} className={styles.searchResultRow}>
                <div>
                  <p className={styles.searchResultName}>{r.name || r.display_name.split(',')[0]}</p>
                  <p className={styles.searchResultAddress}>{r.display_name}</p>
                </div>
                <button onClick={() => startDraftFromSearchResult(r)}>add pin</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.wrapper}>
        <div ref={mapContainer} className={styles.map} />
        <aside className={styles.sidebar}>
          {draftPin && (
            <>
              <p className={styles.sidebarTitle}>new pin</p>
              <input
                className={styles.draftNameInput}
                placeholder="name"
                value={draftPin.name}
                onChange={e => setDraftPin({ ...draftPin, name: e.target.value })}
                autoFocus
              />
              <div className={styles.categoryPicker}>
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.key}
                    type="button"
                    className={styles.categoryPill}
                    style={
                      draftPin.category === cat.key
                        ? { borderColor: cat.color, color: cat.color, fontWeight: 500 }
                        : undefined
                    }
                    onClick={() => setDraftPin({ ...draftPin, category: cat.key })}
                  >
                    <span className={styles.categoryDot} style={{ backgroundColor: cat.color }} />
                    {cat.label}
                  </button>
                ))}
              </div>
              <div className={styles.draftActions}>
                <button
                  className={styles.draftConfirm}
                  onClick={confirmDraftPin}
                  disabled={!draftPin.name.trim()}
                >
                  add pin
                </button>
                <button className={styles.draftCancel} onClick={() => setDraftPin(null)}>
                  cancel
                </button>
              </div>
            </>
          )}

          {!draftPin && !selectedPin && (
            <p className={styles.hint}>search above, click the map, or select a pin to see nearby eats</p>
          )}

          {!draftPin && selectedPin && (
            <>
              <p className={styles.sidebarTitle}>near {selectedPin.name}</p>
              {loadingEats && <p className={styles.hint}>looking for restaurants…</p>}
              {!loadingEats && nearbyEats.length === 0 && (
                <p className={styles.hint}>no restaurants found nearby</p>
              )}
              {nearbyEats.map((eat, i) => (
                <div key={i} className={styles.eatRow}>
                  <p className={styles.eatName}>{eat.name}</p>
                </div>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
