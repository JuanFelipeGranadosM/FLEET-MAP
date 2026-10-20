// Vista previa en un solo HTML: simulador en el navegador, sin API ni teselas externas.
//   npm run build:demo  ->  dist-demo/index.html
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  build: { outDir: 'dist-demo', chunkSizeWarningLimit: 4000 },
});
