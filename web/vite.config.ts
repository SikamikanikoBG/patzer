import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = process.env.PORT ?? '8800';
const SERVER_TARGET = `http://localhost:${SERVER_PORT}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: SERVER_TARGET, changeOrigin: true },
      '/ws':  { target: SERVER_TARGET, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    // Theme images load only while their theme is active, so never inline them.
    assetsInlineLimit: (file) => (file.includes('/themes/') ? false : undefined),
  },
});
