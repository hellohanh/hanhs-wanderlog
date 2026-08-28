import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { loadGoogleMaps } from '../lib/googleMapsLoader'
import { CATEGORIES, ICON_VARIANTS, categoryConfig, groupPinsByCategory, pinBadgeColor, pinIconSvg, type PinCategory } from '../lib/pinCategories'
import type { Pin } from '../types'
import styles from './MapView.module.css'

interface Props {
  tripId: string
}

interface GooglePlaceResult {
  id?: string
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
}

interface DraftPin {
  lat: number
  lng: number
  name: string
  category: PinCategory
  placeId?: string
  icon?: string
}

interface PlaceDetails {
  address?: string
  phone?: string
  website?: string
}

// Hand-built trash icon for the pin-delete button in the sidebar —
// same inline-SVG, no-external-dependency approach as the category
// icons in lib/pinCategories.
const TRASH_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`

// Same approach — pencil icon for the pin-rename button.
const EDIT_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`

// Custom map-pin overlay: attaches a plain HTML element (the same
// nested white-teardrop / colored-circle / icon structure used before)
// to the map at a lat/lng, via Google's OverlayView API. This is what
// lets the exact approved pin design carry over unchanged from the
// previous MapLibre implementation, instead of flattening it into a
// static marker image. Built lazily since `google.maps.OverlayView`
// only exists once the Maps JS API script has finished loading.
let PinOverlayClass: (new (position: google.maps.LatLng, el: HTMLElement) => google.maps.OverlayView) | null =
  null

function getPinOverlayClass() {
  if (!PinOverlayClass) {
    class PinOverlay extends google.maps.OverlayView {
      private el: HTMLElement
      private position: google.maps.LatLng

      constructor(position: google.maps.LatLng, el: HTMLElement) {
        super()
        this.position = position
        this.el = el
      }

      onAdd() {
        this.getPanes()?.overlayMouseTarget.appendChild(this.el)
      }

      draw() {
        const point = this.getProjection()?.fromLatLngToDivPixel(this.position)
        if (point) {
          this.el.style.position = 'absolute'
          // Offsets track the marker's actual size (33x33, see .pinOuter in
          // MapView.module.css): half the width to center horizontally, the
          // full height to anchor the teardrop's bottom point at the pin's
          // lat/lng. Keep these two in sync if the marker size ever changes.
          this.el.style.left = `${point.x - 16.5}px`
          this.el.style.top = `${point.y - 33}px`
        }
      }

      onRemove() {
        this.el.remove()
      }
    }
    PinOverlayClass = PinOverlay
  }
  return PinOverlayClass
}

// Same custom-OverlayView technique as pins above, but centered on its
// point both ways (a pill label has no "tip" to anchor, unlike a
// teardrop pin) via CSS transform: translate(-50%, -50%) rather than a
// hardcoded pixel offset — so this doesn't need updating if the pill's
// size ever changes. Needed because google.maps.Marker's built-in
// `label` is plain colored text only — no background, padding, or
// border-radius support, which a pill shape requires.
let DistrictLabelOverlayClass:
  | (new (position: google.maps.LatLng, el: HTMLElement) => google.maps.OverlayView)
  | null = null

function getDistrictLabelOverlayClass() {
  if (!DistrictLabelOverlayClass) {
    class DistrictLabelOverlay extends google.maps.OverlayView {
      private el: HTMLElement
      private position: google.maps.LatLng

      constructor(position: google.maps.LatLng, el: HTMLElement) {
        super()
        this.position = position
        this.el = el
      }

      onAdd() {
        this.getPanes()?.overlayMouseTarget.appendChild(this.el)
      }

      draw() {
        const point = this.getProjection()?.fromLatLngToDivPixel(this.position)
        if (point) {
          this.el.style.position = 'absolute'
          this.el.style.left = `${point.x}px`
          this.el.style.top = `${point.y}px`
          this.el.style.transform = 'translate(-50%, -50%)'
        }
      }

      onRemove() {
        this.el.remove()
      }
    }
    DistrictLabelOverlayClass = DistrictLabelOverlay
  }
  return DistrictLabelOverlayClass
}

export default function MapView({ tripId }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<google.maps.OverlayView[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [pins, setPins] = useState<Pin[]>([])
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null)
  const [draftPin, setDraftPin] = useState<DraftPin | null>(null)
  const [nearbyEats, setNearbyEats] = useState<{ name: string; lat: number; lng: number }[]>([])
  const [loadingEats, setLoadingEats] = useState(false)
  const [placeDetails, setPlaceDetails] = useState<PlaceDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingPin, setDeletingPin] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')
  const [editIconValue, setEditIconValue] = useState<string | undefined>(undefined)
  const [hoveredPin, setHoveredPin] = useState<Pin | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const [hoverDetails, setHoverDetails] = useState<PlaceDetails | null>(null)
  const [hoverLoading, setHoverLoading] = useState(false)
  const placeDetailsCache = useRef<Map<string, PlaceDetails | null>>(new Map())
  const hoverOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverRequestId = useRef(0)
  const [savingName, setSavingName] = useState(false)
  const [showDistricts, setShowDistricts] = useState(false)
  const districtsLayerRef = useRef<google.maps.Data | null>(null)
  const districtLabelsRef = useRef<google.maps.OverlayView[]>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GooglePlaceResult[]>([])
  const [searching, setSearching] = useState(false)

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string

  useEffect(() => {
    let cancelled = false
    let cleanupResizeHandlers: (() => void) | undefined

    loadGoogleMaps().then(() => {
      if (cancelled || !mapContainer.current || mapRef.current) return

      const map = new google.maps.Map(mapContainer.current, {
        center: { lat: 20, lng: 0 },
        zoom: 2,
        tilt: 0,
        heading: 0,
        mapId,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy'
      })

      // Clicking the map opens the draft form instead of saving right
      // away — this is where name + category both get set.
      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        const lat = e.latLng?.lat()
        const lng = e.latLng?.lng()
        if (lat == null || lng == null) return
        setSelectedPin(null)
        setDraftPin({ lat, lng, name: '', category: 'attraction' })
      })

      mapRef.current = map
      setMapReady(true)

      // Safety net: on mobile the map's container is sized via CSS that
      // resolves after the initial paint (and can change again on
      // rotation), and google.maps.Map sometimes caches a stale/zero
      // size from the moment it was constructed. A resize event tells
      // it to re-measure its container and redraw — cheap and harmless
      // to call an extra time on desktop too.
      const triggerResize = () => {
        google.maps.event.trigger(map, 'resize')
      }
      window.addEventListener('resize', triggerResize)
      window.addEventListener('orientationchange', triggerResize)
      // Also fire once shortly after mount, in case layout was still
      // settling when the map was first constructed.
      const settleTimeout = setTimeout(triggerResize, 300)

      cleanupResizeHandlers = () => {
        window.removeEventListener('resize', triggerResize)
        window.removeEventListener('orientationchange', triggerResize)
        clearTimeout(settleTimeout)
      }
    })

    return () => {
      cancelled = true
      cleanupResizeHandlers?.()
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

  async function createPin(
    name: string,
    lat: number,
    lng: number,
    category: PinCategory,
    placeId?: string,
    icon?: string
  ) {
    const { data: userData } = await supabase.auth.getUser()
    const addedBy = userData.user?.id

    const { error } = await supabase.from('pins').insert({
      trip_id: tripId,
      name,
      category,
      lat,
      lng,
      place_id: placeId ?? null,
      icon: icon ?? null,
      added_by: addedBy
    })

    if (error) {
      console.error('Failed to add pin', error)
      return
    }

    loadPins()

    const map = mapRef.current
    if (map) {
      map.panTo({ lat, lng })
      map.setZoom(14)
    }
  }

  function adjustTilt(amount: number) {
    const map = mapRef.current
    if (!map) return
    const current = map.getTilt() ?? 0
    map.setTilt(Math.max(0, Math.min(67.5, current + amount)))
  }

  function adjustHeading(amount: number) {
    const map = mapRef.current
    if (!map) return
    const current = map.getHeading() ?? 0
    map.setHeading((current + amount + 360) % 360)
  }

  // HCMC's old, informal 22-district layout (pre-July-2025 — the
  // official district system was abolished nationwide, but this is
  // still how everyone, tourism guides included, actually navigates
  // the city day to day). Static asset (public/hcm-districts.geojson,
  // MIT-licensed via OpenStreetMap) rather than a live boundary API —
  // simpler, no ongoing cost, and this data doesn't change. Loaded
  // lazily on first toggle-on; after that, toggling just shows/hides
  // the already-loaded layer and labels rather than reloading.
  async function toggleDistricts() {
    const map = mapRef.current
    if (!map) return

    const next = !showDistricts
    setShowDistricts(next)

    if (districtsLayerRef.current) {
      districtsLayerRef.current.setMap(next ? map : null)
      districtLabelsRef.current.forEach(m => m.setMap(next ? map : null))
      return
    }

    if (!next) return

    const dataLayer = new google.maps.Data({ map })
    const LabelOverlayCls = getDistrictLabelOverlayClass()
    dataLayer.loadGeoJson(`${import.meta.env.BASE_URL}hcm-districts.geojson`, {}, features => {
      features.forEach((feature, i) => {
        // Uniform spacing (i * 360/22) put neighboring districts at
        // similar hues whenever they're also near each other in the
        // file's order — which they often are, since districts are
        // roughly numbered by geographic clustering (District 10/11,
        // 5/6, etc. are both file-adjacent AND map-adjacent). The
        // golden angle (~137.5°) instead — the standard trick for
        // generating a sequence of maximally-separated hues — means no
        // two nearby indices ever land close together on the color
        // wheel, without needing to actually compute which districts
        // border each other.
        const hue = Math.round((i * 137.508) % 360)
        dataLayer.overrideStyle(feature, {
          fillColor: `hsl(${hue}, 65%, 55%)`,
          fillOpacity: 0.2,
          strokeColor: `hsl(${hue}, 65%, 40%)`,
          strokeWeight: 1.5
        })

        const name = feature.getProperty('name') as string | undefined
        const center = feature.getProperty('center') as [number, number] | undefined
        if (name && center) {
          const el = document.createElement('div')
          el.className = styles.districtPill
          el.textContent = name.toUpperCase()
          const overlay = new LabelOverlayCls(new google.maps.LatLng(center[1], center[0]), el)
          overlay.setMap(map)
          districtLabelsRef.current.push(overlay)
        }
      })
    })
    districtsLayerRef.current = dataLayer
  }

  function selectPin(pin: Pin) {
    setDraftPin(null)
    setSelectedPin(pin)
    const map = mapRef.current
    if (map) {
      map.panTo({ lat: pin.lat, lng: pin.lng })
      map.setZoom(14)
    }
  }

  async function confirmDraftPin() {
    if (!draftPin || !draftPin.name.trim()) return
    await createPin(
      draftPin.name.trim(),
      draftPin.lat,
      draftPin.lng,
      draftPin.category,
      draftPin.placeId,
      draftPin.icon
    )
    setDraftPin(null)
  }

  // Uses Places API (New) — Text Search, per E26. Triggered only on
  // explicit submit (not per-keystroke), consistent with the same
  // usage-conscious pattern used for the previous OSM-based search.
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim()) return

    setSearching(true)
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'
        },
        body: JSON.stringify({ textQuery: searchQuery })
      })
      const data = await res.json()
      setSearchResults(data.places ?? [])
    } catch (err) {
      console.error('Places search failed', err)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  function startDraftFromSearchResult(result: GooglePlaceResult) {
    if (!result.location) return
    const name = result.displayName?.text || result.formattedAddress?.split(',')[0] || 'unnamed place'
    setSelectedPin(null)
    setDraftPin({
      lat: result.location.latitude,
      lng: result.location.longitude,
      name,
      category: 'attraction',
      placeId: result.id
    })
    setSearchResults([])
    setSearchQuery('')
  }

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    overlaysRef.current.forEach(o => o.setMap(null))
    overlaysRef.current = []

    const PinOverlayCls = getPinOverlayClass()

    pins.forEach(pin => {
      const cfg = categoryConfig(pin.category)
      const badgeColor = pinBadgeColor(pin.category, pin.icon)

      const el = document.createElement('div')
      el.className = styles.pinMarker
      el.title = `${cfg.label}: ${pin.name}`
      el.innerHTML = `
        <span class="${styles.pinOuter}">
          <span class="${styles.pinInner}" style="background:${badgeColor}">
            <span class="${styles.pinIconWrap}">${pinIconSvg(pin.category, pin.icon)}</span>
          </span>
        </span>
      `

      el.addEventListener('click', evt => {
        evt.stopPropagation()
        setDraftPin(null)
        setSelectedPin(pin)
      })
      // Only wired on devices that actually support hover (desktop
      // mice, trackpads) — touch can fire mouseenter without a clean
      // matching mouseleave, which would risk leaving the tooltip stuck
      // open after a tap on mobile. Mobile already has tap-to-select.
      if (window.matchMedia('(hover: hover)').matches) {
        el.addEventListener('mouseenter', () => handlePinHoverStart(pin, el))
        el.addEventListener('mouseleave', handlePinHoverEnd)
      }

      const overlay = new PinOverlayCls(new google.maps.LatLng(pin.lat, pin.lng), el)
      overlay.setMap(map)
      overlaysRef.current.push(overlay)
    })

    if (pins.length > 0) {
      const first = pins[0]
      map.panTo({ lat: first.lat, lng: first.lng })
      map.setZoom(12)
    }
  }, [pins, mapReady])

  useEffect(() => {
    if (!selectedPin) {
      setNearbyEats([])
      return
    }
    loadNearbyEats(selectedPin)
  }, [selectedPin])

  useEffect(() => {
    setConfirmingDelete(false)
    setEditingName(false)
  }, [selectedPin])

  useEffect(() => {
    if (!selectedPin) {
      setPlaceDetails(null)
      return
    }
    loadPlaceDetails(selectedPin)
  }, [selectedPin])

  // Map-anchored popup for the selected pin — alongside the sidebar
  // panel (which keeps its own separate open/close state), not instead
  // of it, per the user's explicit choice. Mirrors the same
  // selectedPin/placeDetails/loadingDetails state the sidebar already
  // reads, rather than firing a second Places lookup. Closing the
  // popup's own X also clears selectedPin, so the sidebar closes with
  // it — the two don't have to be closed independently by design, just
  // shown independently.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!selectedPin) {
      infoWindowRef.current?.close()
      return
    }

    if (!infoWindowRef.current) {
      // The InfoWindow anchors its tail at the raw lat/lng point — but
      // that's exactly where our custom teardrop marker's TIP sits (see
      // the OverlayView draw() offset above: the shape extends 33px
      // upward from that point), so without an offset the popup's tail
      // lands on the pin's base and the whole bubble overlaps the
      // marker shape. Pushing the tail up by the marker's height (33px)
      // clears it — the popup then sits on top of the pin instead of
      // covering it.
      infoWindowRef.current = new google.maps.InfoWindow({ pixelOffset: new google.maps.Size(0, -33) })
      infoWindowRef.current.addListener('closeclick', () => setSelectedPin(null))
    }
    const iw = infoWindowRef.current

    const mapsUrl = selectedPin.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${selectedPin.place_id}`
      : `https://www.google.com/maps/search/?api=1&query=${selectedPin.lat},${selectedPin.lng}`

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    const rows: string[] = []
    if (loadingDetails) {
      rows.push('<p style="margin:6px 0 0;font-size:13px;color:#6b6b66;">looking up details…</p>')
    } else if (placeDetails) {
      if (placeDetails.address) rows.push(`<p style="margin:6px 0 0;font-size:13px;">${esc(placeDetails.address)}</p>`)
      if (placeDetails.phone) rows.push(`<p style="margin:4px 0 0;font-size:13px;">${esc(placeDetails.phone)}</p>`)
      if (placeDetails.website) {
        rows.push(
          `<p style="margin:4px 0 0;font-size:13px;"><a href="${esc(placeDetails.website)}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8;">${esc(placeDetails.website)}</a></p>`
        )
      }
    }

    iw.setContent(`
      <div style="font-family:'Segoe UI',sans-serif;min-width:200px;max-width:260px;">
        <p style="margin:0;font-size:15px;font-weight:600;">${esc(selectedPin.name)}</p>
        ${rows.join('')}
        <p style="margin:8px 0 0;font-size:13px;"><a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8;">View in Google Maps</a></p>
      </div>
    `)
    iw.setPosition({ lat: selectedPin.lat, lng: selectedPin.lng })
    iw.open(map)
  }, [selectedPin, placeDetails, loadingDetails])

  // Name/address/phone for the selected pin. Search-added pins carry a
  // real Google place_id (captured at creation, see startDraftFromSearchResult)
  // and get a direct Place Details (New) lookup. Pins without one — map-click
  // drops, or anything created before this feature — fall back to a
  // best-effort Text Search by name, biased to the pin's location; this can
  // mismatch or come up empty for generic names or non-business pins, which
  // is expected and handled as "no additional details found" below.
  // Pure fetch, no component state — shared by the sidebar's detail
  // panel (loadPlaceDetails below) and the hover tooltip, so there's
  // one lookup implementation instead of two copies that could drift.
  // See loadPlaceDetails for the place_id-vs-fallback-search rationale.
  async function fetchPlaceDetails(pin: Pin): Promise<PlaceDetails | null> {
    try {
      let address: string | undefined
      let phone: string | undefined
      let website: string | undefined

      if (pin.place_id) {
        const res = await fetch(`https://places.googleapis.com/v1/places/${pin.place_id}`, {
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'formattedAddress,internationalPhoneNumber,websiteUri'
          }
        })
        const data = await res.json()
        address = data.formattedAddress
        phone = data.internationalPhoneNumber
        website = data.websiteUri
      } else {
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.formattedAddress,places.internationalPhoneNumber,places.websiteUri'
          },
          body: JSON.stringify({
            textQuery: pin.name,
            locationBias: {
              circle: {
                center: { latitude: pin.lat, longitude: pin.lng },
                radius: 300
              }
            }
          })
        })
        const data = await res.json()
        const match = (data.places ?? [])[0]
        address = match?.formattedAddress
        phone = match?.internationalPhoneNumber
        website = match?.websiteUri
      }

      return address || phone || website ? { address, phone, website } : null
    } catch (err) {
      console.error('Place details lookup failed', err)
      return null
    }
  }

  // Hover tooltip on a map marker (desktop mouse only — touch doesn't
  // fire these the same way, which is fine since mobile already has
  // tap-to-select). 300ms hover-intent delay before showing anything
  // or firing a lookup, so casually gliding the cursor across several
  // pins doesn't trigger a burst of Places API calls; the cache means
  // re-hovering the same pin afterward is instant either way. Closing
  // has its own short, cancelable delay (a small hover-card pattern) —
  // the tooltip sits just above the marker, so without it, moving the
  // mouse from the marker up into the tooltip itself would trigger the
  // marker's mouseleave first and close it before you could reach it.
  function handlePinHoverStart(pin: Pin, el: HTMLElement) {
    if (hoverCloseTimeoutRef.current) {
      clearTimeout(hoverCloseTimeoutRef.current)
      hoverCloseTimeoutRef.current = null
    }
    if (hoverOpenTimeoutRef.current) clearTimeout(hoverOpenTimeoutRef.current)
    hoverOpenTimeoutRef.current = setTimeout(() => {
      const containerRect = mapContainer.current?.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      if (!containerRect) return

      setHoveredPin(pin)
      setHoverPos({ x: elRect.left - containerRect.left + elRect.width / 2, y: elRect.top - containerRect.top })
      setHoverDetails(null)

      const requestId = ++hoverRequestId.current
      if (placeDetailsCache.current.has(pin.id)) {
        setHoverDetails(placeDetailsCache.current.get(pin.id) ?? null)
        return
      }
      setHoverLoading(true)
      fetchPlaceDetails(pin).then(details => {
        placeDetailsCache.current.set(pin.id, details)
        if (hoverRequestId.current === requestId) {
          setHoverDetails(details)
          setHoverLoading(false)
        }
      })
    }, 300)
  }

  function handlePinHoverEnd() {
    if (hoverOpenTimeoutRef.current) clearTimeout(hoverOpenTimeoutRef.current)
    hoverCloseTimeoutRef.current = setTimeout(() => {
      hoverRequestId.current++
      setHoveredPin(null)
      setHoverPos(null)
      setHoverDetails(null)
      setHoverLoading(false)
    }, 150)
  }

  function cancelHoverClose() {
    if (hoverCloseTimeoutRef.current) {
      clearTimeout(hoverCloseTimeoutRef.current)
      hoverCloseTimeoutRef.current = null
    }
  }

  async function loadPlaceDetails(pin: Pin) {
    setLoadingDetails(true)
    // .has() check (not ??) because a cached "no details found" result
    // is legitimately `null` — `??` would otherwise treat that the same
    // as "not cached yet" and re-fetch every time.
    const details = placeDetailsCache.current.has(pin.id)
      ? placeDetailsCache.current.get(pin.id)!
      : await fetchPlaceDetails(pin)
    placeDetailsCache.current.set(pin.id, details)
    setPlaceDetails(details)
    setLoadingDetails(false)
  }

  // Pin deletion: RLS mirrors E5 (full edit rights for every trip member,
  // no owner/contributor tiers) — same "trip member" check used for
  // viewing/adding pins, see migration 003.
  async function deleteSelectedPin() {
    if (!selectedPin) return
    setDeletingPin(true)
    const { error } = await supabase.from('pins').delete().eq('id', selectedPin.id)
    setDeletingPin(false)
    if (error) {
      console.error('Failed to delete pin', error)
      return
    }
    setSelectedPin(null)
    setConfirmingDelete(false)
    loadPins()
  }

  function startEditName(pin: Pin) {
    setConfirmingDelete(false)
    setEditNameValue(pin.name)
    setEditIconValue(pin.icon ?? undefined)
    setEditingName(true)
  }

  // Renaming (and, for categories with icon variants, re-icon-ing)
  // requires an UPDATE grant + RLS policy on pins — neither existed
  // before this feature (pins previously only had select/insert, then
  // delete as of migration 003). Same E5 "any trip member can edit"
  // check as everywhere else, added via migration 004.
  async function saveEditName() {
    if (!selectedPin) return
    const trimmed = editNameValue.trim()
    if (!trimmed) return
    setSavingName(true)
    const { error } = await supabase
      .from('pins')
      .update({ name: trimmed, icon: editIconValue ?? null })
      .eq('id', selectedPin.id)
    setSavingName(false)
    if (error) {
      console.error('Failed to rename pin', error)
      return
    }
    setSelectedPin({ ...selectedPin, name: trimmed, icon: editIconValue ?? null })
    setEditingName(false)
    loadPins()
  }

  // Uses Places API (New) — Nearby Search, per E26.
  async function loadNearbyEats(pin: Pin) {
    setLoadingEats(true)
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.location'
        },
        body: JSON.stringify({
          includedTypes: ['restaurant'],
          maxResultCount: 8,
          locationRestriction: {
            circle: {
              center: { latitude: pin.lat, longitude: pin.lng },
              radius: 600
            }
          }
        })
      })
      const data = await res.json()
      const results = (data.places ?? []).map((p: any) => ({
        name: p.displayName?.text ?? 'unnamed restaurant',
        lat: p.location?.latitude,
        lng: p.location?.longitude
      }))
      setNearbyEats(results)
    } catch (err) {
      console.error('Places nearby search failed', err)
      setNearbyEats([])
    } finally {
      setLoadingEats(false)
    }
  }

  const sidebarOpen = draftPin !== null || selectedPin !== null

  function closeSidebar() {
    setDraftPin(null)
    setSelectedPin(null)
  }

  return (
    <div>
      <div className={styles.searchBar}>
        <form className={styles.searchForm} onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="search by name or address"
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
                  <p className={styles.searchResultName}>
                    {r.displayName?.text || r.formattedAddress?.split(',')[0]}
                  </p>
                  <p className={styles.searchResultAddress}>{r.formattedAddress}</p>
                </div>
                <button onClick={() => startDraftFromSearchResult(r)}>add pin</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.wrapper}>
        <div className={styles.mapPane}>
          <div ref={mapContainer} className={styles.map} />
          {mapReady && (
            <div className={styles.tiltControls}>
              <button type="button" title="Tilt up" onClick={() => adjustTilt(10)}>
                ⤒
              </button>
              <button type="button" title="Tilt down" onClick={() => adjustTilt(-10)}>
                ⤓
              </button>
              <button type="button" title="Rotate left" onClick={() => adjustHeading(-20)}>
                ⟲
              </button>
              <button type="button" title="Rotate right" onClick={() => adjustHeading(20)}>
                ⟳
              </button>
            </div>
          )}

          {mapReady && (
            <button
              type="button"
              className={styles.districtsToggle}
              data-active={showDistricts}
              onClick={toggleDistricts}
              title="Show HCMC district boundaries"
            >
              districts
            </button>
          )}

          {hoveredPin && hoverPos && (
            <div
              className={styles.hoverTooltip}
              style={{ left: hoverPos.x, top: hoverPos.y }}
              onMouseEnter={cancelHoverClose}
              onMouseLeave={handlePinHoverEnd}
            >
              <p className={styles.hoverTooltipName}>{hoveredPin.name}</p>
              {hoverLoading && <p className={styles.hoverTooltipHint}>looking up details…</p>}
              {!hoverLoading && hoverDetails?.address && (
                <p className={styles.hoverTooltipDetail}>{hoverDetails.address}</p>
              )}
              {!hoverLoading && hoverDetails?.phone && (
                <p className={styles.hoverTooltipDetail}>{hoverDetails.phone}</p>
              )}
              {!hoverLoading && !hoverDetails && (
                <p className={styles.hoverTooltipHint}>no additional details found</p>
              )}
            </div>
          )}
        </div>

        {/* On mobile this becomes a slide-up bottom sheet (see .sidebar
            media query) — hidden until a pin is tapped or a new one
            dropped, controlled via .sidebarOpen. On desktop it's the
            always-visible side panel, unchanged. */}
        <div
          className={styles.sidebarBackdrop}
          data-open={sidebarOpen}
          onClick={closeSidebar}
        />
        <aside className={styles.sidebar} data-open={sidebarOpen}>
          <button
            type="button"
            className={styles.sidebarClose}
            onClick={closeSidebar}
            aria-label="close"
          >
            ×
          </button>
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
                    onClick={() => setDraftPin({ ...draftPin, category: cat.key, icon: undefined })}
                  >
                    <span className={styles.categoryDot} style={{ backgroundColor: cat.color }} />
                    {cat.label}
                  </button>
                ))}
              </div>
              {ICON_VARIANTS[draftPin.category] && (
                <IconPicker
                  category={draftPin.category}
                  selected={draftPin.icon}
                  onSelect={key => setDraftPin({ ...draftPin, icon: key })}
                />
              )}
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
              <div className={styles.placeDetails}>
                <div className={styles.placeNameRow}>
                  {!editingName && (
                    <>
                      <p className={styles.placeName}>{selectedPin.name}</p>
                      {!confirmingDelete && (
                        <div className={styles.placeActions}>
                          <button
                            type="button"
                            className={styles.iconButton}
                            title="edit name"
                            aria-label="edit name"
                            onClick={() => startEditName(selectedPin)}
                            dangerouslySetInnerHTML={{ __html: EDIT_ICON }}
                          />
                          <button
                            type="button"
                            className={`${styles.iconButton} ${styles.deleteIcon}`}
                            title="delete pin"
                            aria-label="delete pin"
                            onClick={() => setConfirmingDelete(true)}
                            dangerouslySetInnerHTML={{ __html: TRASH_ICON }}
                          />
                        </div>
                      )}
                      {confirmingDelete && (
                        <div className={styles.deleteConfirm}>
                          <span>delete?</span>
                          <button
                            type="button"
                            className={styles.deleteConfirmYes}
                            onClick={deleteSelectedPin}
                            disabled={deletingPin}
                          >
                            {deletingPin ? '…' : 'yes'}
                          </button>
                          <button
                            type="button"
                            className={styles.deleteConfirmNo}
                            onClick={() => setConfirmingDelete(false)}
                            disabled={deletingPin}
                          >
                            no
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {editingName && (
                    <div className={styles.editNameForm}>
                      <input
                        className={styles.editNameInput}
                        value={editNameValue}
                        onChange={e => setEditNameValue(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className={styles.editNameSave}
                        onClick={saveEditName}
                        disabled={savingName || !editNameValue.trim()}
                      >
                        {savingName ? '…' : 'save'}
                      </button>
                      <button
                        type="button"
                        className={styles.editNameCancel}
                        onClick={() => setEditingName(false)}
                        disabled={savingName}
                      >
                        cancel
                      </button>
                    </div>
                  )}
                </div>
                {editingName && ICON_VARIANTS[selectedPin.category] && (
                  <IconPicker
                    category={selectedPin.category}
                    selected={editIconValue}
                    onSelect={key => setEditIconValue(key)}
                  />
                )}
                {loadingDetails && <p className={styles.hint}>looking up details…</p>}
                {!loadingDetails && placeDetails?.address && (
                  <p className={styles.placeAddress}>{placeDetails.address}</p>
                )}
                {!loadingDetails && placeDetails?.phone && (
                  <p className={styles.placePhone}>{placeDetails.phone}</p>
                )}
                {!loadingDetails && placeDetails?.website && (
                  <a
                    className={styles.placePhone}
                    href={placeDetails.website}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {placeDetails.website}
                  </a>
                )}
                {!loadingDetails && !placeDetails && (
                  <p className={styles.hint}>no additional details found</p>
                )}
              </div>

              <p className={styles.sidebarTitle}>nearby eats</p>
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

          {/* Always visible in this panel, regardless of the draft-pin
              form or nearby-eats state above — a running list of every
              pin on this trip, tap to select + pan/zoom the map to it. */}
          <div className={styles.pinnedSection}>
            <p className={styles.sidebarTitle}>pinned ({pins.length})</p>
            {pins.length === 0 && <p className={styles.hint}>no pins yet</p>}
            {pins.length > 0 && (
              <div className={styles.pinnedList}>
                {groupPinsByCategory(pins).map(group => (
                  <div key={group.key} className={styles.pinnedGroup}>
                    <p className={styles.pinnedGroupLabel}>{group.label}</p>
                    {group.pins.map(pin => (
                      <button
                        key={pin.id}
                        type="button"
                        className={styles.pinnedRow}
                        data-active={selectedPin?.id === pin.id}
                        onClick={() => selectPin(pin)}
                      >
                        <span className={styles.pinnedDot} style={{ backgroundColor: pinBadgeColor(pin.category, pin.icon) }} />
                        <span className={styles.pinnedName}>{pin.name}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

// Shared between the "new pin" draft form and the pencil-triggered edit
// form — only rendered for categories with more than a plain default
// icon (see ICON_VARIANTS). `selected` undefined/unset means "category
// default", shown as the first ("general") option being active.
function IconPicker({
  category,
  selected,
  onSelect
}: {
  category: PinCategory
  selected: string | undefined
  onSelect: (key: string | undefined) => void
}) {
  const variants = ICON_VARIANTS[category]
  if (!variants) return null
  const cfg = categoryConfig(category)

  return (
    <div className={styles.iconPicker}>
      {variants.map(variant => {
        const isActive = (selected ?? 'general') === variant.key
        const variantColor = variant.color ?? cfg.color
        return (
          <button
            key={variant.key}
            type="button"
            className={styles.iconPill}
            style={isActive ? { borderColor: variantColor, color: variantColor, fontWeight: 500 } : undefined}
            title={variant.label}
            onClick={() => onSelect(variant.key === 'general' ? undefined : variant.key)}
          >
            <span className={styles.iconPillBadge} style={{ backgroundColor: variantColor }}>
              <span dangerouslySetInnerHTML={{ __html: variant.svg }} />
            </span>
            {variant.label}
          </button>
        )
      })}
    </div>
  )
}
