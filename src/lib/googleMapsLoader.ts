import { Loader } from '@googlemaps/js-api-loader'

const loader = new Loader({
  apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string,
  version: 'weekly'
})

let loadPromise: Promise<typeof google> | null = null

// Loads the Maps JavaScript API exactly once, no matter how many
// components call this. Places (New) and Directions are used as plain
// REST calls (fetch) elsewhere, not loaded as JS libraries here.
export function loadGoogleMaps(): Promise<typeof google> {
  if (!loadPromise) {
    loadPromise = loader.load()
  }
  return loadPromise
}
