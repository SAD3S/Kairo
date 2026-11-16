// Graphe routier construit à partir d'une réponse Overpass (JSON). Pur, testable sans Android.
// Nœuds du graphe = intersections et extrémités de voies ; chaque arête garde sa géométrie.
import { haversine, LatLon } from './geo';

/** Types de voies carrossables (mode voiture). */
export const CAR_HIGHWAYS = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road',
] as const;
/** Grands axes : seuls utilisés entre A et B quand la distance est grande. */
export const MAJOR_HIGHWAYS = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link'] as const;

const SPEED_KMH: Record<string, number> = {
  motorway: 120, motorway_link: 60, trunk: 100, trunk_link: 50, primary: 75, primary_link: 45,
  secondary: 65, secondary_link: 40, tertiary: 50, tertiary_link: 35, unclassified: 45,
  residential: 30, living_street: 15, service: 15, road: 40,
};
const EXCLUDED_ACCESS = /^(no|private|delivery|agricultural|forestry|destination_only)$/;

export function parseMaxspeed(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  const named: Record<string, number> = { 'fr:urban': 50, 'fr:rural': 80, 'fr:motorway': 130, 'fr:zone30': 30, walk: 6, 'living_street': 20 };
  if (named[s]) return named[s];
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'mph' ? n * 1.609 : n;
}

export function speedFor(tags: Record<string, string>): number {
  const base = SPEED_KMH[tags.highway] ?? 40;
  const max = parseMaxspeed(tags.maxspeed);
  // On roule un peu sous la limite en moyenne.
  return max ? Math.min(max * 0.9, base * 1.5) : base;
}

/** -1 : sens inverse uniquement, 1 : sens de saisie uniquement, 0 : double sens. */
export function onewayOf(tags: Record<string, string>): -1 | 0 | 1 {
  const o = (tags.oneway ?? '').toLowerCase();
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === 'no' || o === 'false' || o === '0') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
  return 0;
}

export function isDrivable(tags: Record<string, string> | undefined): boolean {
  if (!tags?.highway || !(CAR_HIGHWAYS as readonly string[]).includes(tags.highway)) return false;
  if (tags.area === 'yes') return false;
  if (EXCLUDED_ACCESS.test(tags.access ?? '') || EXCLUDED_ACCESS.test(tags.motor_vehicle ?? '') || EXCLUDED_ACCESS.test(tags.motorcar ?? '')) return false;
  if (tags.service === 'parking_aisle' || tags.service === 'driveway') return false;
  return true;
}

export interface Graph {
  /** Coordonnées des nœuds : lat[i], lon[i]. */
  lat: Float64Array | Float32Array;
  lon: Float64Array | Float32Array;
  /** Liste d'adjacence compacte (CSR) : arêtes sortantes de i = [first[i], first[i+1]). */
  first: Int32Array;
  to: Int32Array;
  from: Int32Array;
  /** Coût en secondes, longueur en mètres. */
  cost: Float64Array | Float32Array;
  length: Float64Array | Float32Array;
  /** Index du nom de rue dans `names` (-1 si aucun). */
  name: Int32Array;
  names: string[];
  /** Géométrie : points de l'arête e = geo[geoStart[e]*2 … geoStart[e+1]*2) en paires lon,lat. */
  geoStart: Int32Array;
  geo: Float64Array | Float32Array;
  /** Vitesse max du graphe (m/s), pour l'heuristique A*. */
  vmax: number;
  nodeCount: number;
  edgeCount: number;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export function buildGraph(json: { elements: OverpassElement[] }): Graph {
  const coords = new Map<number, [number, number]>();
  const ways: OverpassElement[] = [];
  for (const el of json.elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) coords.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.nodes && el.nodes.length > 1 && isDrivable(el.tags)) ways.push(el);
  }

  // Un nœud OSM devient un nœud du graphe s'il est une extrémité ou partagé par plusieurs voies.
  const use = new Map<number, number>();
  for (const w of ways) for (const id of w.nodes!) use.set(id, (use.get(id) ?? 0) + 1);
  const gIndex = new Map<number, number>();
  const gLat: number[] = [];
  const gLon: number[] = [];
  const nodeOf = (osm: number) => {
    let i = gIndex.get(osm);
    if (i === undefined) {
      const c = coords.get(osm)!;
      i = gLat.length;
      gIndex.set(osm, i);
      gLat.push(c[0]);
      gLon.push(c[1]);
    }
    return i;
  };

  const names: string[] = [];
  const nameIdx = new Map<string, number>();
  type E = { a: number; b: number; cost: number; len: number; name: number; pts: number[] };
  const edges: E[] = [];
  let vmax = 1;

  for (const w of ways) {
    const tags = w.tags!;
    const ids = w.nodes!.filter((id) => coords.has(id));
    if (ids.length < 2) continue;
    const kmh = speedFor(tags);
    const ms = kmh / 3.6;
    vmax = Math.max(vmax, ms);
    const dir = onewayOf(tags);
    const label = tags.name || tags.ref || '';
    let ni = -1;
    if (label) {
      ni = nameIdx.get(label) ?? -1;
      if (ni < 0) { ni = names.length; names.push(label); nameIdx.set(label, ni); }
    }

    let start = 0;
    for (let k = 1; k < ids.length; k++) {
      const isNode = k === ids.length - 1 || (use.get(ids[k]) ?? 0) > 1;
      if (!isNode) continue;
      const seg = ids.slice(start, k + 1);
      let len = 0;
      const pts: number[] = [];
      for (let j = 0; j < seg.length; j++) {
        const c = coords.get(seg[j])!;
        pts.push(c[1], c[0]);
        if (j) {
          const p = coords.get(seg[j - 1])!;
          len += haversine(p[0], p[1], c[0], c[1]);
        }
      }
      const a = nodeOf(seg[0]);
      const b = nodeOf(seg[seg.length - 1]);
      if (a !== b) {
        const cost = len / ms;
        if (dir >= 0) edges.push({ a, b, cost, len, name: ni, pts });
        if (dir <= 0) {
          const rev: number[] = [];
          for (let j = pts.length - 2; j >= 0; j -= 2) rev.push(pts[j], pts[j + 1]);
          edges.push({ a: b, b: a, cost, len, name: ni, pts: rev });
        }
      }
      start = k;
    }
  }

  const n = gLat.length;
  const m = edges.length;
  const first = new Int32Array(n + 1);
  for (const e of edges) first[e.a + 1]++;
  for (let i = 0; i < n; i++) first[i + 1] += first[i];
  const fill = first.slice(0, n);
  const to = new Int32Array(m), from = new Int32Array(m), name = new Int32Array(m);
  const cost = new Float64Array(m), length = new Float64Array(m);
  const order = new Int32Array(m);
  edges.forEach((e, idx) => { order[fill[e.a]++] = idx; });
  const geoStart = new Int32Array(m + 1);
  let total = 0;
  for (let k = 0; k < m; k++) { geoStart[k] = total; total += edges[order[k]].pts.length / 2; }
  geoStart[m] = total;
  const geo = new Float64Array(total * 2);
  for (let k = 0; k < m; k++) {
    const e = edges[order[k]];
    to[k] = e.b; from[k] = e.a; cost[k] = e.cost; length[k] = e.len; name[k] = e.name;
    geo.set(e.pts, geoStart[k] * 2);
  }
  return { lat: Float64Array.from(gLat), lon: Float64Array.from(gLon), first, to, from, cost, length, name, names, geoStart, geo, vmax, nodeCount: n, edgeCount: m };
}

/** Nœud du graphe le plus proche d'un point, parmi ceux qui ont des arêtes dans le sens voulu. */
export function nearestNode(g: Graph, p: LatLon, need: 'out' | 'in' = 'out'): { node: number; distance: number } | null {
  let hasIn: Uint8Array | null = null;
  if (need === 'in') {
    hasIn = new Uint8Array(g.nodeCount);
    for (let e = 0; e < g.edgeCount; e++) hasIn[g.to[e]] = 1;
  }
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < g.nodeCount; i++) {
    if (need === 'out' ? g.first[i + 1] === g.first[i] : !hasIn![i]) continue;
    const d = haversine(p.lat, p.lon, g.lat[i], g.lon[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best < 0 ? null : { node: best, distance: bestD };
}

/** Points [lon, lat] d'une arête. */
export function edgeCoords(g: Graph, e: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = g.geoStart[e]; k < g.geoStart[e + 1]; k++) out.push([g.geo[k * 2], g.geo[k * 2 + 1]]);
  return out;
}
