import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Engine comparison prototype. Run the game server first (npm start), then npm run proto.
export default defineConfig({
  root: __dirname,
  build: {
    outDir: resolve(__dirname, '../../dist/proto'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), three: resolve(__dirname, 'three.html'), babylon: resolve(__dirname, 'babylon.html') } },
  },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:3000', '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
  preview: {
    port: 5174,
    proxy: { '/api': 'http://localhost:3000', '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
});
