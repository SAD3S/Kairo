// Itinéraire « à suivre » : tracé, distances cumulées et manœuvres (pur, testable).
import { bearing, haversine, LatLon, turnAngle } from './geo';
import { Graph } from './graph';
import { SearchResult } from './search';
import { T } from './strings';

export type ManeuverType = 'depart' | 'slight-right' | 'slight-left' | 'right' | 'left' | 'uturn' | 'arrive';

export interface Maneuver {
  type: ManeuverType;
  /** Angle de virage (°), positif à droite. */
  angle: number;
  /** Distance depuis le départ (m). */
  at: number;
  lat: number;
  lon: number;
  street?: string;
}

export interface RoutePlan {
  /** Tracé [lon, lat]. */
  coords: [number, number][];
  /** Distance cumulée (m) à chaque point du tracé. */
  cum: number[];
  maneuvers: Maneuver[];
  distance: number;
  time: number;
}

/** Seuils (°) : < 20 tout droit, 20–60 léger, 60–150 tourner, > 150 demi-tour. */
export function classifyTurn(angle: number): ManeuverType | null {
  const a = Math.abs(angle);
  if (a < 20) return null;
  if (a > 150) return 'uturn';
  if (a < 60) return angle > 0 ? 'slight-right' : 'slight-left';
  return angle > 0 ? 'right' : 'left';
}

/** Point situé à la distance `d` (m) le long du tracé. */
export function pointAt(coords: [number, number][], cum: number[], d: number): [number, number] {
  if (d <= 0) return coords[0];
  const last = cum.length - 1;
  if (d >= cum[last]) return coords[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (d - cum[lo]) / seg;
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
}

export function cumulative(coords: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  return cum;
}

interface Boundary {
  at: number;
  street?: string;
}

/**
 * Génère les manœuvres à partir d'un tracé et des points de jonction (intersections).
 * Les caps sont mesurés ~20 m avant/après le point pour lisser les petites variations ;
 * deux virages du même côté à moins de 25 m l'un de l'autre sont fusionnés.
 */
export function buildManeuvers(coords: [number, number][], cum: number[], boundaries: Boundary[], firstStreet?: string): Maneuver[] {
  const total = cum[cum.length - 1];
  const out: Maneuver[] = [{ type: 'depart', angle: 0, at: 0, lat: coords[0][1], lon: coords[0][0], street: firstStreet }];
  const W = 20;
  const raw: Maneuver[] = [];
  for (const b of boundaries) {
    if (b.at < 5 || b.at > total - 5) continue;
    const back = pointAt(coords, cum, Math.max(0, b.at - W));
    const here = pointAt(coords, cum, b.at);
    const ahead = pointAt(coords, cum, Math.min(total, b.at + W));
    const bin = bearing(back[1], back[0], here[1], here[0]);
    const bout = bearing(here[1], here[0], ahead[1], ahead[0]);
    raw.push({ type: 'depart', angle: turnAngle(bin, bout), at: b.at, lat: here[1], lon: here[0], street: b.street });
  }
  // Fusion des petites variations successives.
  const merged: Maneuver[] = [];
  for (const m of raw) {
    const prev = merged[merged.length - 1];
    if (prev && m.at - prev.at < 25 && Math.sign(m.angle) === Math.sign(prev.angle)) {
      prev.angle += m.angle;
      prev.street = m.street ?? prev.street;
      continue;
    }
    merged.push({ ...m });
  }
  for (const m of merged) {
    const type = classifyTurn(m.angle);
    if (type) out.push({ ...m, type });
  }
  const end = coords[coords.length - 1];
  out.push({ type: 'arrive', angle: 0, at: total, lat: end[1], lon: end[0] });
  return out;
}

/** Construit l'itinéraire complet depuis le résultat de recherche, avec A et B réels aux extrémités. */
export function buildRoute(g: Graph, r: SearchResult, a?: LatLon, b?: LatLon): RoutePlan {
  const coords: [number, number][] = [];
  const boundaries: Boundary[] = [];
  const push = (c: [number, number]) => {
    const l = coords[coords.length - 1];
    if (!l || l[0] !== c[0] || l[1] !== c[1]) coords.push(c);
  };
  if (a) push([a.lon, a.lat]);
  if (r.nodes.length) push([g.lon[r.nodes[0]], g.lat[r.nodes[0]]]);
  const streets: (string | undefined)[] = [];
  const boundaryIdx: number[] = [];
  r.edges.forEach((e, i) => {
    if (i > 0) boundaryIdx.push(coords.length - 1);
    streets.push(g.name[e] >= 0 ? g.names[g.name[e]] : undefined);
    for (let k = g.geoStart[e] + 1; k < g.geoStart[e + 1]; k++) push([g.geo[k * 2], g.geo[k * 2 + 1]]);
  });
  if (b) push([b.lon, b.lat]);
  if (coords.length === 1) push([...coords[0]] as [number, number]);
  const cum = cumulative(coords);
  boundaryIdx.forEach((idx, i) => boundaries.push({ at: cum[idx], street: streets[i + 1] }));
  // Les changements de rue sans virage ne donnent pas d'instruction (filtrés par l'angle).
  const maneuvers = buildManeuvers(coords, cum, boundaries, streets[0]);
  const distance = cum[cum.length - 1];
  // Temps : celui du graphe + les bouts à pied jusqu'aux nœuds rattachés, comptés à 20 km/h.
  const extra = Math.max(0, distance - r.distance);
  return { coords, cum, maneuvers, distance, time: r.time + extra / (20 / 3.6) };
}

const VERB: Record<ManeuverType, string> = {
  depart: T.goStraight,
  'slight-right': T.slightRight,
  'slight-left': T.slightLeft,
  right: T.turnRight,
  left: T.turnLeft,
  uturn: T.uturn,
  arrive: T.arrive,
};

/** Texte d'une manœuvre : « tournez à droite sur rue de la Paix ». */
export function maneuverText(m: Maneuver): string {
  if (m.type === 'depart') return m.street ? T.departOn(m.street) : T.depart;
  if (m.type === 'arrive') return VERB.arrive;
  return m.street ? `${VERB[m.type]} ${T.on} ${m.street}` : VERB[m.type];
}

/** Annonce vocale : « Dans 200 mètres, tournez à droite sur rue de la Paix ». */
export function spokenAnnouncement(m: Maneuver, distanceM: number | 'now'): string {
  if (distanceM === 'now') {
    if (m.type === 'arrive') return T.arrived;
    return T.nowPrefix(maneuverText(m));
  }
  const d = distanceM >= 1000 ? T.km(distanceM / 1000) : T.meters(Math.round(distanceM / 10) * 10);
  const t = maneuverText(m);
  return `${T.inDistance(d)}, ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}
