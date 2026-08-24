import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// NOTE: base must match the GitHub repo name once one exists,
// e.g. '/hanhs-wanderlog/' if the repo is github.com/you/hanhs-wanderlog.
// Update this before the first deploy — not yet confirmed with the user.
export default defineConfig({
  base: '/hanhs-wanderlog/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: "Hanh's Wanderlog",
        short_name: 'Wanderlog',
        description: 'A personal, map-first trip planning app',
        theme_color: '#FF9900',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
})
