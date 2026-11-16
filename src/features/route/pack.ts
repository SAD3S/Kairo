// Pack hors ligne d'une région : graphe routier binaire, index d'adresses, tuiles de carte.
// Ce module est pur (décodage, recherche) ; le téléchargement natif est dans packStore.ts.
import { Graph } from './graph';
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

/**
 * Format binaire « KGR1 » (petit-boutiste), écrit par tools/pack/build_pack.py :
 * en-tête 44 octets : 'KGR1', u32 version, N nœuds, M arêtes, P points, octets des noms,
 * f32 vmax, f32 bbox ×4 ; puis lat f32[N], lon f32[N], first i32[N+1], to i32[M], cost f32[M],
 * length f32[M], name i32[M], geoStart i32[M+1], geo f32[2P], noms UTF-8 séparés par « \n ».
 */
export function decodeGraph(buf: ArrayBuffer): Graph {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'KGR1') throw new Error('Pack de routes invalide');
  const n = dv.getUint32(8, true);
  const m = dv.getUint32(12, true);
  const p = dv.getUint32(16, true);
  const namesLen = dv.getUint32(20, true);
  const vmax = dv.getFloat32(24, true);
  let off = 44;
  const f32 = (len: number) => { const a = new Float32Array(buf, off, len); off += len * 4; return a; };
  const i32 = (len: number) => { const a = new Int32Array(buf, off, len); off += len * 4; return a; };
  const lat = f32(n), lon = f32(n), first = i32(n + 1), to = i32(m), cost = f32(m), length = f32(m), name = i32(m), geoStart = i32(m + 1), geo = f32(p * 2);
  const names = namesLen ? new TextDecoder().decode(new Uint8Array(buf, off, namesLen)).split('\n') : [];
  const from = new Int32Array(m);
  for (let i = 0; i < n; i++) for (let e = first[i]; e < first[i + 1]; e++) from[e] = i;
  return { lat, lon, first, to, from, cost, length, name, names, geoStart, geo, vmax, nodeCount: n, edgeCount: m };
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
