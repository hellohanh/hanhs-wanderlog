import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { loadGoogleMaps } from '../lib/googleMapsLoader'
import { CATEGORIES, ICON_VARIANTS, categoryConfig, groupPinsByCategory, pinIconSvg, type PinCategory } from '../lib/pinCategories'
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
          // Offsets track the marker's actual size (25x25, see .pinMarker in
          // MapView.module.css): half the width to center horizontally, the
          // full height to anchor the teardrop's bottom point at the pin's
          // lat/lng. Keep these two in sync if the marker size ever changes.
          this.el.style.left = `${point.x - 12.5}px`
          this.el.style.top = `${point.y - 25}px`
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
  const [savingName, setSavingName] = useState(false)

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
        fullscreenControl: false
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

      const el = document.createElement('div')
      el.className = styles.pinMarker
      el.title = `${cfg.label}: ${pin.name}`
      el.innerHTML = `
        <span class="${styles.pinOuter}">
          <span class="${styles.pinInner}" style="background:${cfg.color}">
            <span class="${styles.pinIconWrap}">${pinIconSvg(pin.category, pin.icon)}</span>
          </span>
        </span>
      `

      el.addEventListener('click', evt => {
        evt.stopPropagation()
        setDraftPin(null)
        setSelectedPin(pin)
      })

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

  // Name/address/phone for the selected pin. Search-added pins carry a
  // real Google place_id (captured at creation, see startDraftFromSearchResult)
  // and get a direct Place Details (New) lookup. Pins without one — map-click
  // drops, or anything created before this feature — fall back to a
  // best-effort Text Search by name, biased to the pin's location; this can
  // mismatch or come up empty for generic names or non-business pins, which
  // is expected and handled as "no additional details found" below.
  async function loadPlaceDetails(pin: Pin) {
    setLoadingDetails(true)
    try {
      let address: string | undefined
      let phone: string | undefined

      if (pin.place_id) {
        const res = await fetch(`https://places.googleapis.com/v1/places/${pin.place_id}`, {
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'formattedAddress,internationalPhoneNumber'
          }
        })
        const data = await res.json()
        address = data.formattedAddress
        phone = data.internationalPhoneNumber
      } else {
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.formattedAddress,places.internationalPhoneNumber'
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
      }

      setPlaceDetails(address || phone ? { address, phone } : null)
    } catch (err) {
      console.error('Place details lookup failed', err)
      setPlaceDetails(null)
    } finally {
      setLoadingDetails(false)
    }
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
                        <span className={styles.pinnedDot} style={{ backgroundColor: group.color }} />
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
        return (
          <button
            key={variant.key}
            type="button"
            className={styles.iconPill}
            style={isActive ? { borderColor: cfg.color, color: cfg.color, fontWeight: 500 } : undefined}
            title={variant.label}
            onClick={() => onSelect(variant.key === 'general' ? undefined : variant.key)}
          >
            <span className={styles.iconPillBadge} style={{ backgroundColor: cfg.color }}>
              <span dangerouslySetInnerHTML={{ __html: variant.svg }} />
            </span>
            {variant.label}
          </button>
        )
      })}
    </div>
  )
}
