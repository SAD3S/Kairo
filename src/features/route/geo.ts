// Géométrie terrestre (pure, sans Android ni DOM).
export interface LatLon {
  lat: number;
  lon: number;
}

const R = 6371008.8; // rayon moyen de la Terre (m)
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const dist = (a: LatLon, b: LatLon) => haversine(a.lat, a.lon, b.lat, b.lon);

/** Cap initial de a vers b, en degrés [0, 360). 0 = nord, 90 = est. */
export function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin(rad(bLon - aLon)) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLon - aLon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Différence de cap signée dans (-180, 180] : positif = vers la droite. */
export function turnAngle(inBearing: number, outBearing: number): number {
  let d = (outBearing - inBearing) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Rectangle englobant les points, agrandi de `margin` (0.2 = 20 %) et d'au moins `minM` mètres. */
export function bboxAround(points: LatLon[], margin = 0.2, minM = 300): BBox {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of points) {
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
    w = Math.min(w, p.lon); e = Math.max(e, p.lon);
  }
  const midLat = (s + n) / 2;
  const mLat = 1 / 111320;
  const mLon = 1 / (111320 * Math.cos(rad(midLat)));
  const padLat = Math.max((n - s) * margin, minM * mLat);
  const padLon = Math.max((e - w) * margin, minM * mLon);
  return { south: s - padLat, west: w - padLon, north: n + padLat, east: e + padLon };
}

/** Projection locale équirectangulaire (mètres) — précise sur quelques km. */
export function toXY(p: LatLon, ref: LatLon): [number, number] {
  return [rad(p.lon - ref.lon) * R * Math.cos(rad(ref.lat)), rad(p.lat - ref.lat) * R];
}

/** Point le plus proche de p sur le segment [a, b] : distance (m) et ratio t ∈ [0, 1]. */
export function projectOnSegment(p: LatLon, a: LatLon, b: LatLon): { d: number; t: number; point: LatLon } {
  const [ax, ay] = toXY(a, p);
  const [bx, by] = toXY(b, p);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { d: Math.hypot(x, y), t, point: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t } };
}

export function formatDistance(m: number): string {
  if (m >= 10000) return `${Math.round(m / 1000)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(0, Math.round(m))} m`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
