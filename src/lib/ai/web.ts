// Accès Internet pour l'IA, via l'API de recherche web d'Ollama
// (compte Ollama gratuit + clé API). Fonctionne quel que soit le moteur d'IA.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { AiError } from './types';
import { Source } from '../types';

async function cloudPost(path: string, body: unknown, key: string): Promise<any> {
  if (!key) throw new AiError('Recherche web non configurée.', 'Ajoute ta clé API Ollama dans les réglages.');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.post({ url: `https://ollama.com${path}`, headers, data: body });
    if (r.status >= 400) throw new AiError(`Recherche web : erreur ${r.status}.`, r.status === 401 ? 'Clé API Ollama invalide.' : undefined);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const res = await fetch(`./ollama-cloud${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new AiError(`Recherche web : erreur ${res.status}.`, res.status === 401 ? 'Clé API Ollama invalide.' : undefined);
  return res.json();
}

export interface WebResult extends Source {
  content: string;
}

export async function webSearch(query: string, key: string, max = 4): Promise<WebResult[]> {
  const json = await cloudPost('/api/web_search', { query, max_results: max }, key);
  return (json.results || []).map((r: any) => ({ title: r.title || r.url, url: r.url, content: String(r.content || '') }));
}

export async function webFetch(url: string, key: string): Promise<WebResult> {
  const json = await cloudPost('/api/web_fetch', { url }, key);
  return { title: json.title || url, url, content: String(json.content || '') };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
