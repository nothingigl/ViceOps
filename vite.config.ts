import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'three-vendor',
              test: /[\\/]node_modules[\\/]three[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Vice Ops: Tactical Drive',
        short_name: 'Vice Ops',
        description:
          'Тактический офлайн-автосимулятор с DMZ-контрактами, 3D-гаражом и физикой 60 Гц',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#090d16',
        theme_color: '#090d16',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
      },
    }),
  ],
});
