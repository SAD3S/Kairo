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
