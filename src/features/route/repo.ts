// Accès réseau : Photon (adresses) et Overpass (routes). User-Agent explicite, comme demandé par les services OSM.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { bboxAround, BBox, dist, LatLon } from './geo';
import { CAR_HIGHWAYS, MAJOR_HIGHWAYS } from './graph';
import { T } from './strings';

export const USER_AGENT = 'Kairo/1.0 (app de notes et navigation; https://github.com/SAD3S/Kairo)';
export const MAX_KM = 50;
/** En dessous, on charge toutes les rues entre A et B ; au-delà, seulement les grands axes (+ rues autour de A et B). */
export const DETAIL_KM = 8;
export const LOCAL_RADIUS_M = 2500;

export class RouteError extends Error {}

/** GET texte avec User-Agent : client HTTP natif sur Android, proxy local sur ordinateur. */
export async function httpGet(url: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<{ status: number; text: string }> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const abortable = <X,>(p: Promise<X>) =>
    new Promise<X>((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new DOMException('Annulé', 'AbortError'));
      const onAbort = () => reject(new DOMException('Annulé', 'AbortError'));
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      p.then(resolve, reject).finally(() => opts.signal?.removeEventListener('abort', onAbort));
    });
  if (Capacitor.isNativePlatform()) {
    const r = await abortable(
      CapacitorHttp.get({ url, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, responseType: 'text', connectTimeout: 15000, readTimeout: timeoutMs }),
    );
    return { status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  opts.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(`./web-proxy?ua=kairo&url=${encodeURIComponent(url)}`, { signal: ctrl.signal });
    return { status: res.status, text: await res.text() };
  } catch (e: any) {
    if (opts.signal?.aborted) throw new DOMException('Annulé', 'AbortError');
    if (e?.name === 'AbortError') return { status: 504, text: '' };
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- Photon

export interface Place extends LatLon {
  id: string;
  name: string;
  context: string;
}

export function parsePhoton(json: any): Place[] {
  const out: Place[] = [];
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ');
    const name = p.name || streetLine || p.city || p.county || '';
    if (!name) continue;
    const city = [p.postcode, p.city || p.town || p.village || p.county].filter(Boolean).join(' ');
    const context = [p.name && streetLine ? streetLine : '', city, !city ? p.state || p.country : ''].filter(Boolean).join(', ');
    out.push({ id: `${p.osm_type ?? ''}${p.osm_id ?? out.length}`, name, context, lat, lon });
  }
  return out;
}

export async function photonSearch(q: string, bias: LatLon | null, signal?: AbortSignal): Promise<Place[]> {
  let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=5`;
  if (bias) url += `&lat=${bias.lat.toFixed(5)}&lon=${bias.lon.toFixed(5)}`;
  let r: { status: number; text: string };
  try {
    r = await httpGet(url, { signal, timeoutMs: 8000 });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new RouteError(T.photonError);
  }
  if (r.status >= 400) throw new RouteError(T.photonError);
  try {
    return parsePhoton(JSON.parse(r.text));
  } catch {
    throw new RouteError(T.photonError);
  }
}

// ---------------------------------------------------------------- Overpass

const bboxStr = (b: BBox) => `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
const hwRegex = (list: readonly string[]) => `^(${list.join('|')})$`;
const filters = `["access"!~"^(no|private)$"]["motor_vehicle"!~"^(no|private)$"]`;

/** Requête Overpass : détail complet près de A et B, grands axes seulement entre les deux si c'est loin. */
export function overpassQuery(a: LatLon, b: LatLon): string {
  const km = dist(a, b) / 1000;
  const all = `way["highway"~"${hwRegex(CAR_HIGHWAYS)}"]${filters}`;
  const big = bboxAround([a, b], 0.2);
  let body: string;
  if (km <= DETAIL_KM) {
    body = `${all}(${bboxStr(big)});`;
  } else {
    const major = `way["highway"~"${hwRegex(MAJOR_HIGHWAYS)}"]${filters}`;
    const around = (p: LatLon) => bboxStr(bboxAround([p], 0, LOCAL_RADIUS_M));
    body = `(${major}(${bboxStr(big)});${all}(${around(a)});${all}(${around(b)}););`;
  }
  return `[out:json][timeout:90];${body}out body;>;out skel qt;`;
}

export async function fetchRoads(a: LatLon, b: LatLon, signal?: AbortSignal): Promise<string> {
  const km = dist(a, b) / 1000;
  if (km > MAX_KM) throw new RouteError(T.tooFar(Math.round(km), MAX_KM));
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery(a, b))}`;
  let r: { status: number; text: string };
  try {
    r = await httpGet(url, { signal, timeoutMs: 120000 });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new RouteError(T.overpassError);
  }
  if (r.status === 429) throw new RouteError(T.overpassBusy);
  if (r.status === 504 || /runtime error.*timed out|Timeout/i.test(r.text.slice(0, 2000))) throw new RouteError(T.overpassTimeout);
  if (r.status >= 400 || !r.text.trimStart().startsWith('{')) throw new RouteError(T.overpassError);
  return r.text;
}
