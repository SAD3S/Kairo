// Accès Internet pour l'IA.
// Par défaut : DuckDuckGo (gratuit, sans compte ni clé) + lecture directe des pages.
// Optionnel : API de recherche d'Ollama si une clé est renseignée (repli sur DuckDuckGo en cas d'échec).
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { AiError } from './types';
import { Source } from '../types';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

export interface WebResult extends Source {
  content: string;
}

/** Télécharge du texte : HTTP natif sur Android (pas de CORS), proxy local sur ordinateur. */
async function getText(url: string, timeoutMs = 10000): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' }, responseType: 'text', connectTimeout: timeoutMs, readTimeout: timeoutMs });
    if (r.status >= 400) throw new AiError(`Erreur ${r.status} sur ${hostOf(url)}`);
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`./web-proxy?url=${encodeURIComponent(url)}`, { signal: ctrl.signal });
    if (!res.ok) throw new AiError(`Erreur ${res.status} sur ${hostOf(url)}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', hellip: '…', mdash: '—', ndash: '–' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (ENTITIES[k]) return ENTITIES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
}

/** HTML → texte lisible (sans scripts, menus, styles). */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim());
  const main = html.match(/<(article|main)[\s\S]*?<\/\1>/i)?.[0] ?? html;
  const text = decodeEntities(
    main
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return { title, text };
}

/** Extrait les résultats de la page HTML de DuckDuckGo. */
export function parseDuckDuckGo(html: string, max = 5): WebResult[] {
  const out: WebResult[] = [];
  const re = /<a([^>]*class="result__a"[^>]*)>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="result__a"|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < max) {
    const href = m[1].match(/href="([^"]+)"/)?.[1];
    if (!href) continue;
    let url = decodeEntities(href);
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue; // publicités
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    const snip = m[3].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '';
    out.push({ title, url, content: decodeEntities(snip.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

async function duckSearch(query: string, max: number): Promise<WebResult[]> {
  const html = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=fr-fr`);
  const results = parseDuckDuckGo(html, max);
  if (!results.length && /anomaly|captcha/i.test(html)) throw new AiError('DuckDuckGo demande une vérification, réessaie dans un moment.');
  // Complète les 2 premiers résultats avec le contenu de la page (en parallèle, avec délai court).
  await Promise.all(
    results.slice(0, 2).map(async (r) => {
      try {
        const page = htmlToText(await getText(r.url, 7000));
        if (page.text.length > r.content.length) r.content = `${r.content}\n${page.text.slice(0, 2500)}`;
      } catch {
        /* on garde l'extrait */
      }
    }),
  );
  return results;
}

async function ollamaPost(path: string, body: unknown, key: string): Promise<any> {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.post({ url: `https://ollama.com${path}`, headers, data: body });
    if (r.status >= 400) throw new AiError(`Ollama : erreur ${r.status}`);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const res = await fetch(`./ollama-cloud${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new AiError(`Ollama : erreur ${res.status}`);
  return res.json();
}

export async function webSearch(query: string, key: string, max = 4): Promise<WebResult[]> {
  if (key) {
    try {
      const json = await ollamaPost('/api/web_search', { query, max_results: max }, key);
      return (json.results || []).map((r: any) => ({ title: r.title || r.url, url: r.url, content: String(r.content || '') }));
    } catch {
      /* repli sur DuckDuckGo */
    }
  }
  return duckSearch(query, max);
}

export async function webFetch(url: string, _key = ''): Promise<WebResult> {
  const page = htmlToText(await getText(url, 12000));
  return { title: page.title || url, url, content: page.text };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
