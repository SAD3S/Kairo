// Accès réseau : Photon (recherche de lieux). User-Agent explicite, comme demandé par les services OSM.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { LatLon } from './geo';
import { T } from './strings';

export const USER_AGENT = 'Kairo/1.0 (app de notes et carte; https://github.com/SAD3S/Kairo)';

export class MapError extends Error {}

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
    throw new MapError(T.photonError);
  }
  if (r.status >= 400) throw new MapError(T.photonError);
  try {
    return parsePhoton(JSON.parse(r.text));
  } catch {
    throw new MapError(T.photonError);
  }
}
