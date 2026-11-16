import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Sur ordinateur (navigateur), les appels vers ollama.com (recherche web)
// passent par ce proxy pour éviter les blocages CORS.
// Sur Android, l'app utilise le client HTTP natif de Capacitor.
const proxy = {
  '/ollama-cloud': {
    target: 'https://ollama.com',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/ollama-cloud/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { proxy },
  preview: { proxy },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node' },
} as any);
