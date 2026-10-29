import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// L'interface est servie par le serveur de l'officine (même origine, CSP « default-src 'self' ») :
// aucune ressource en ligne, aucun data: URI (assetsInlineLimit 0), aucune ressource externe.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', assetsInlineLimit: 0, sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VP_API ?? 'https://localhost:8443', secure: false, changeOrigin: false } },
  },
});
