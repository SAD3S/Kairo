// Carte MapLibre (tuiles OpenFreeMap en ligne, ou pack hors ligne) : marqueurs et détection des gestes.
import { useEffect, useRef, useState } from 'react';
import { Map as MlMap, Marker, setWorkerUrl } from 'maplibre-gl';
// Le worker de MapLibre est empaqueté par Vite (sinon il est introuvable une fois l'app compilée).
import mlWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LatLon } from './geo';
import { perfMark } from '../../lib/perf';

setWorkerUrl(mlWorkerUrl);

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function markerEl(kind: 'place' | 'user') {
  const el = document.createElement('div');
  if (kind === 'user') {
    el.className = 'user-dot';
    el.innerHTML = '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="rgba(139,140,248,.25)"/><path d="M17 6l7 18-7-4-7 4z" fill="#8B8CF8" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  } else {
    el.className = 'pin pin-place';
  }
  return el;
}

export interface MapApi {
  map: MlMap | null;
  ready: boolean;
  setPlace(p: LatLon | null): void;
  setUser(p: LatLon | null, bearing?: number): void;
  /** Appelé quand l'utilisateur glisse, zoome, tourne ou incline la carte à la main. */
  onUserGesture(cb: (() => void) | null): void;
}

export function useMap(container: React.RefObject<HTMLDivElement | null>, style: string | object, initial: { center: [number, number]; zoom: number }): MapApi {
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const markers = useRef<Partial<Record<'place' | 'user', Marker>>>({});
  const gestureCb = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const t0 = performance.now();
    const map = new MlMap({
      container: container.current,
      style: style as any,
      center: initial.center,
      zoom: initial.zoom,
      attributionControl: { compact: true },
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.on('load', () => {
      setReady(true);
      perfMark('map.ready', performance.now() - t0, typeof style === 'string' ? 'carte en ligne' : 'carte hors ligne');
    });
    const gesture = (e: any) => { if (e.originalEvent) gestureCb.current?.(); };
    for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) map.on(ev, gesture);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [container]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMarker = (kind: 'place' | 'user', p: LatLon | null, rotation = 0) => {
    const map = mapRef.current;
    if (!map) return;
    const m = markers.current[kind];
    if (!p) { m?.remove(); delete markers.current[kind]; return; }
    if (m) { m.setLngLat([p.lon, p.lat]); if (kind === 'user') m.setRotation(rotation); return; }
    markers.current[kind] = new Marker({ element: markerEl(kind), rotationAlignment: kind === 'user' ? 'map' : 'viewport', rotation, anchor: kind === 'user' ? 'center' : 'bottom' })
      .setLngLat([p.lon, p.lat])
      .addTo(map);
  };

  return {
    map: mapRef.current,
    ready,
    setPlace: (p) => setMarker('place', p),
    setUser: (p, b = 0) => setMarker('user', p, b),
    onUserGesture(cb) {
      gestureCb.current = cb;
    },
  };
}
