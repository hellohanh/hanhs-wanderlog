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

// Icon + color per category, used for both the marker badges on the map
// and the category picker in the "add pin" form.
const CATEGORIES: { key: PinCategory; label: string; emoji: string; color: string }[] = [
  { key: 'attraction', label: 'Attraction', emoji: '📍', color: '#FF9900' },
  { key: 'dining', label: 'Dining', emoji: '🍴', color: '#D85A30' },
  { key: 'cafe', label: 'Cafe', emoji: '☕', color: '#BA7517' },
  { key: 'bakery', label: 'Bakery/Dessert', emoji: '🧁', color: '#D4537E' },
  { key: 'accommodation', label: 'Accommodation', emoji: '🛏️', color: '#378ADD' },
  { key: 'airport', label: 'Airport/Transport', emoji: '✈️', color: '#7F77DD' },
  { key: 'shopping', label: 'Shopping', emoji: '🛍️', color: '#639922' }
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
      const el = document.createElement('div')
      el.className = styles.pinMarker
      el.style.backgroundColor = cfg.color
      el.title = `${cfg.label}: ${pin.name}`
      el.textContent = cfg.emoji

      const marker = new maplibregl.Marker({ element: el })
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
