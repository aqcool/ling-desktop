import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        assetFileNames: asset => asset.name?.endsWith('.css')
          ? 'renderer.css'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
})
