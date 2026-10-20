import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo /api se redirige a FastAPI (puerto 8000), incluido el WebSocket.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:8000', ws: true, changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: { manualChunks: { map: ['maplibre-gl', 'react-map-gl/maplibre'], deck: ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/aggregation-layers', '@deck.gl/mapbox'], charts: ['echarts', 'echarts-for-react'] } },
    },
  },
});
