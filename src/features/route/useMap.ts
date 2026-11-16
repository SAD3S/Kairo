// Carte MapLibre (tuiles OpenFreeMap, sans clé) et couches de l'itinéraire.
import { useEffect, useRef, useState } from 'react';
import { GeoJSONSource, LngLatBounds, Map as MlMap, Marker, setWorkerUrl, type PaddingOptions } from 'maplibre-gl';
// Le worker de MapLibre est empaqueté par Vite (sinon il est introuvable une fois l'app compilée).
import mlWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(mlWorkerUrl);
import 'maplibre-gl/dist/maplibre-gl.css';
import { LatLon } from './geo';
import { Wave } from './wave';
import { perfMark } from '../../lib/perf';

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const EMPTY: any = { type: 'FeatureCollection', features: [] };

function markerEl(kind: 'A' | 'B' | 'user') {
  const el = document.createElement('div');
  if (kind === 'user') {
    el.className = 'user-dot';
    el.innerHTML = '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="rgba(139,140,248,.25)"/><path d="M17 6l7 18-7-4-7 4z" fill="#8B8CF8" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  } else {
    el.className = `pin pin-${kind}`;
    el.textContent = kind;
  }
  return el;
}

export interface MapApi {
  map: MlMap | null;
  ready: boolean;
  /** Rendu animé de la recherche (créé au chargement de la carte). */
  wave: Wave | null;
  /** Vrai tant que la caméra suit la position (navigation). */
  onUserGesture(cb: (() => void) | null): void;
  setRoute(coords: [number, number][] | null): void;
  setPoint(kind: 'A' | 'B', p: LatLon | null, center?: boolean): void;
  setUser(p: LatLon | null, bearing?: number): void;
  fit(points: [number, number][], padding?: PaddingOptions): void;
}

export function useMap(container: React.RefObject<HTMLDivElement | null>, style: string | object, onLongPress: (p: LatLon) => void): MapApi {
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const waveRef = useRef<Wave | null>(null);
  const gestureCb = useRef<(() => void) | null>(null);
  const markers = useRef<Partial<Record<'A' | 'B' | 'user', Marker>>>({});
  const longPressCb = useRef(onLongPress);
  longPressCb.current = onLongPress;

  useEffect(() => {
    if (!container.current) return;
    const t0 = performance.now();
    const map = new MlMap({
      container: container.current,
      style: style as any,
      center: [2.3488, 48.8534],
      zoom: 11,
      attributionControl: { compact: true },
      dragRotate: true,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.on('load', () => {
      waveRef.current = new Wave(map, typeof style !== 'string');
      map.addSource('route', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#2B2B8C', 'line-width': 10, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#8B8CF8', 'line-width': 6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      setReady(true);
      perfMark('map.ready', performance.now() - t0, typeof style === 'string' ? 'carte en ligne' : 'carte hors ligne');
    });

    // Appui long (tactile) ou clic droit : définir A ou B.
    let timer: number | null = null;
    let start: { x: number; y: number } | null = null;
    const cancel = () => { if (timer) window.clearTimeout(timer); timer = null; };
    map.on('touchstart', (e: any) => {
      if (e.originalEvent.touches.length !== 1) return cancel();
      start = { x: e.point.x, y: e.point.y };
      const ll = e.lngLat;
      cancel();
      timer = window.setTimeout(() => longPressCb.current({ lat: ll.lat, lon: ll.lng }), 550);
    });
    map.on('touchmove', (e: any) => { if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 10) cancel(); });
    map.on('touchend', cancel);
    map.on('touchcancel', cancel);
    map.on('movestart', (e: any) => { if (e.originalEvent) cancel(); });
    // Geste de l'utilisateur (glisser, zoomer, tourner, incliner) : coupe le suivi en navigation.
    const gesture = (e: any) => { if (e.originalEvent) gestureCb.current?.(); };
    for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) map.on(ev, gesture);
    map.on('contextmenu', (e: any) => longPressCb.current({ lat: e.lngLat.lat, lon: e.lngLat.lng }));

    return () => {
      cancel();
      map.remove();
      mapRef.current = null;
    };
  }, [container]);

  const src = (id: string) => mapRef.current?.getSource(id) as GeoJSONSource | undefined;

  const setMarker = (kind: 'A' | 'B' | 'user', p: LatLon | null, rotation = 0) => {
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
    get wave() {
      return waveRef.current;
    },
    onUserGesture(cb) {
      gestureCb.current = cb;
    },
    setRoute(coords) {
      src('route')?.setData(coords ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : EMPTY);
    },
    setPoint(kind, p, center) {
      setMarker(kind, p);
      if (p && center) mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 700 });
    },
    setUser(p, bearing = 0) {
      setMarker('user', p, bearing);
    },
    fit(points, padding) {
      const map = mapRef.current;
      if (!map || !points.length) return;
      const b = new LngLatBounds(points[0], points[0]);
      points.forEach((p) => b.extend(p));
      map.fitBounds(b, { padding: padding ?? { top: 190, bottom: 300, left: 40, right: 40 }, duration: 700, maxZoom: 16 });
    },
  };
}
