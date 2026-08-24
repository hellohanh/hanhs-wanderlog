import { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MLMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { supabase } from '../lib/supabaseClient'
import type { Pin } from '../types'
import styles from './MapView.module.css'

interface Props {
  tripId: string
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
  const [nearbyEats, setNearbyEats] = useState<{ name: string; lat: number; lng: number }[]>([])
  const [loadingEats, setLoadingEats] = useState(false)

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: OSM_STYLE,
      center: [0, 20],
      zoom: 2
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('click', async e => {
      const name = window.prompt('name this attraction')
      if (!name) return

      const { data: userData } = await supabase.auth.getUser()
      const addedBy = userData.user?.id

      const { error } = await supabase.from('pins').insert({
        trip_id: tripId,
        name,
        category: 'attraction',
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
        added_by: addedBy
      })

      if (error) {
        console.error('Failed to add pin', error)
        return
      }

      loadPins()
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

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    pins.forEach(pin => {
      const el = document.createElement('div')
      el.className = styles.pinMarker
      el.textContent = pin.category === 'attraction' ? '📍' : '🍴'

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map)

      el.addEventListener('click', evt => {
        evt.stopPropagation()
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
    <div className={styles.wrapper}>
      <div ref={mapContainer} className={styles.map} />
      <aside className={styles.sidebar}>
        {!selectedPin && (
          <p className={styles.hint}>click the map to drop a pin, or select one to see nearby eats</p>
        )}
        {selectedPin && (
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
  )
}
