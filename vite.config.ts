import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    assetsInlineLimit: 256_000,
    rollupOptions: {
      output: {
        assetFileNames: asset => asset.name?.endsWith('.css')
          ? 'renderer.css'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
})
