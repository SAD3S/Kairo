import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Sur ordinateur, l'app lit les pages web via ce petit proxy local (le navigateur
// bloque les requêtes directes vers d'autres sites). Sur Android, inutile.
function webProxy(): Plugin {
  const handler = async (req: any, res: any, next: any) => {
    if (!req.url?.startsWith('/web-proxy')) return next();
    const target = new URL(req.url, 'http://x').searchParams.get('url') || '';
    if (!/^https?:\/\//.test(target)) { res.statusCode = 400; return res.end('url invalide'); }
    try {
      const kairo = new URL(req.url, 'http://x').searchParams.get('ua') === 'kairo';
      const ua = kairo
        ? 'Kairo/1.0 (app de notes et navigation; https://github.com/SAD3S/Kairo)'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
      const r = await fetch(target, { headers: { 'User-Agent': ua, 'Accept-Language': 'fr-FR,fr;q=0.9' }, redirect: 'follow' });
      res.statusCode = r.status;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(await r.text());
    } catch (e: any) {
      res.statusCode = 502;
      res.end(String(e?.message || e));
    }
  };
  return {
    name: 'kairo-web-proxy',
    configureServer: (s) => { s.middlewares.use(handler); },
    configurePreviewServer: (s) => { s.middlewares.use(handler); },
  };
}

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
  plugins: [react(), webProxy()],
  base: './',
  server: { proxy },
  preview: { proxy },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node' },
} as any);
