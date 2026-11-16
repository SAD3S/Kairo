// Pack hors ligne d'une région : index d'adresses et tuiles de carte.
// Ce module est pur (recherche) ; le téléchargement natif est dans packStore.ts.
import { haversine, LatLon } from './geo';
import { Place } from './repo';

export const PACK_ID = 'idf';
export const PACK_NAME = 'Île-de-France';
export const PACK_BASE = 'https://github.com/SAD3S/Kairo/releases/download/pack-idf';
/** Emprise de l'Île-de-France (ouest, sud, est, nord). */
export const PACK_BBOX: [number, number, number, number] = [1.44, 48.12, 3.56, 49.24];

export function insidePack(p: LatLon, bbox = PACK_BBOX) {
  return p.lon >= bbox[0] && p.lon <= bbox[2] && p.lat >= bbox[1] && p.lat <= bbox[3];
}

// ------------------------------------------------------------ Recherche hors ligne

export type PlaceRow = [name: string, context: string, lat: number, lon: number, rank: number];

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9 ]+/g, ' ');
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'au', 'aux', 'et', 'en']);
const ABBR: Record<string, string> = { av: 'avenue', bd: 'boulevard', bld: 'boulevard', pl: 'place', r: 'rue', st: 'saint', ste: 'sainte', imp: 'impasse', ch: 'chemin', fg: 'faubourg', qu: 'quai' };

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t && !STOP.has(t)).map((t) => ABBR[t] ?? t);
}

export class OfflineIndex {
  private rows: PlaceRow[];
  private keys: string[][];

  constructor(rows: PlaceRow[]) {
    this.rows = rows;
    this.keys = rows.map((r) => tokens(`${r[0]} ${r[1]}`));
  }

  get size() {
    return this.rows.length;
  }

  /** Tous les mots tapés doivent commencer un mot du nom ou du contexte ; un numéro en tête est ignoré. */
  search(q: string, bias: LatLon | null, limit = 5): Place[] {
    const qt = tokens(q).filter((t, i) => !(i === 0 && /^\d+[a-z]?$/.test(t) && tokens(q).length > 1));
    if (!qt.length) return [];
    const hits: { i: number; score: number }[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      const k = this.keys[i];
      let ok = true;
      let exact = 0;
      for (const t of qt) {
        let found = false;
        for (const w of k) {
          if (w.startsWith(t)) { found = true; if (w === t) exact++; break; }
        }
        if (!found) { ok = false; break; }
      }
      if (!ok) continue;
      const r = this.rows[i];
      const nameStarts = normalize(r[0]).startsWith(normalize(q).trim()) ? 1 : 0;
      const d = bias ? haversine(bias.lat, bias.lon, r[2], r[3]) : 0;
      // Plus petit = mieux : rang du type, mots exacts, début du nom, proximité.
      const score = r[4] * 2 - exact - nameStarts * 3 + Math.log10(1 + d / 1000) * 1.5;
      hits.push({ i, score });
    }
    hits.sort((a, b) => a.score - b.score);
    return hits.slice(0, limit).map(({ i }) => {
      const r = this.rows[i];
      return { id: `off-${i}`, name: r[0], context: r[1], lat: r[2], lon: r[3] };
    });
  }
}
