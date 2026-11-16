// Rendu de la recherche en « onde lumineuse » (couche d'affichage seulement, l'algorithme n'est pas touché).
// Une seule source GeoJSON enrichie par ajouts à chaque image (updateData), couches créées une fois.
import { GeoJSONSource, LngLatBounds, Map as MlMap } from 'maplibre-gl';
import { LatLon } from './geo';
import { cumulative, pointAt } from './instructions';
import { shownAt, Trace } from './trace';

/** Palette : cyan → violet de l'app (#8B8CF8) → magenta. */
export const WAVE = { start: '#00E5FF', mid: '#8B8CF8', end: '#FF2D95', path: '#00FF9C', frontier: '#FFF3B0' };
const EMPTY: any = { type: 'FeatureCollection', features: [] };
const FADE_FRAMES = 45; // âge (en images) après lequel une arête atteint son opacité minimale
const DIM = 'wave-dim';

const colorBy = ['interpolate', ['linear'], ['get', 'c'], 0, WAVE.start, 0.5, WAVE.mid, 1, WAVE.end];

export interface WaveProgress {
  shown: number;
  explored: number;
  elapsed: number;
}

export class Wave {
  private raf = 0;
  private skipFlag = false;
  private frame = 0;
  private fade = 1;

  constructor(private map: MlMap, private darkBase: boolean) {
    const add = (id: string) => map.addSource(id, { type: 'geojson', data: EMPTY });
    // Voile qui assombrit et désature le fond pendant la recherche (instantané : pas de changement de style).
    map.addLayer({ id: DIM, type: 'background', paint: { 'background-color': '#05060C', 'background-opacity': 0 } });
    add('wave');
    map.addLayer({ id: 'wave-glow', type: 'line', source: 'wave', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colorBy as any, 'line-width': 9, 'line-blur': 6, 'line-opacity': 0.35 } });
    map.addLayer({ id: 'wave-core', type: 'line', source: 'wave', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colorBy as any, 'line-width': 2, 'line-opacity': 0.9 } });
    add('wave-front');
    map.addLayer({ id: 'wave-front-halo', type: 'circle', source: 'wave-front', paint: { 'circle-color': WAVE.frontier, 'circle-radius': 8, 'circle-blur': 1, 'circle-opacity': 0.45 } });
    map.addLayer({ id: 'wave-front-dot', type: 'circle', source: 'wave-front', paint: { 'circle-color': '#FFFFFF', 'circle-radius': 2.2, 'circle-opacity': 0.95 } });
    add('wave-path');
    map.addLayer({ id: 'wave-path-glow', type: 'line', source: 'wave-path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': WAVE.path, 'line-width': 16, 'line-blur': 10, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'wave-path', type: 'line', source: 'wave-path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': WAVE.path, 'line-width': 6 } });
    add('wave-flash');
    map.addLayer({ id: 'wave-flash', type: 'circle', source: 'wave-flash', paint: { 'circle-color': WAVE.path, 'circle-radius': 0, 'circle-blur': 0.6, 'circle-opacity': 0 } });
  }

  private src(id: string) {
    return this.map.getSource(id) as GeoJSONSource | undefined;
  }

  private setDim(v: number) {
    v = Math.max(0, Math.min(1, v));
    this.map.setPaintProperty(DIM, 'background-opacity', v * (this.darkBase ? 0.55 : 0.78));
  }

  /** Opacité des arêtes selon leur âge : récentes à fond, anciennes vers 0,25 (mis à jour par lots). */
  private setAge() {
    const age = ['-', this.frame, ['get', 'b']];
    this.map.setPaintProperty('wave-core', 'line-opacity', ['*', this.fade, ['interpolate', ['linear'], age, 0, 1, FADE_FRAMES, 0.25]] as any);
    this.map.setPaintProperty('wave-glow', 'line-opacity', ['*', this.fade, ['interpolate', ['linear'], age, 0, 0.5, FADE_FRAMES, 0.18]] as any);
  }

  /** Efface tout (exploration, chemin, voile). */
  clear() {
    cancelAnimationFrame(this.raf);
    this.skipFlag = false;
    for (const id of ['wave', 'wave-front', 'wave-path', 'wave-flash']) this.src(id)?.setData(EMPTY);
    this.setDim(0);
  }

  skip() {
    this.skipFlag = true;
  }

  /** Caméra inclinée à 50°, cadrée sur A–B. */
  frame50(a: LatLon, b: LatLon) {
    const bounds = new LngLatBounds([a.lon, a.lat], [a.lon, a.lat]).extend([b.lon, b.lat]);
    const cam = this.map.cameraForBounds(bounds, { padding: { top: 230, bottom: 260, left: 50, right: 50 }, maxZoom: 16 });
    if (cam) this.map.easeTo({ ...cam, pitch: 50, bearing: 0, duration: 900 });
  }

  private loop(step: (now: number) => boolean) {
    return new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const t = performance.now();
        const more = step(now);
        // Mesure de la charge du rendu (diagnostic) : temps passé dans chaque image.
        const w = window as any;
        if (w.__waveCost) w.__waveCost.push(performance.now() - t);
        if (more) this.raf = requestAnimationFrame(tick);
        else resolve();
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  /** Rejoue l'exploration en `duration` ms (courbe ease-in-out), puis la fin : flash sur B, chemin de B vers A, recadrage. */
  async play(trace: Trace, duration: number, route: [number, number][], b: LatLon, onProgress: (p: WaveProgress) => void) {
    this.clear();
    this.fade = 1;
    this.frame = 0;
    const start = performance.now();
    let shown = 0;
    let lastHud = 0;

    // 1. Exploration
    await this.loop((now) => {
      const elapsed = Math.max(0, now - start);
      this.setDim(Math.min(1, elapsed / 400));
      const target = this.skipFlag ? trace.count : shownAt(trace.count, elapsed, duration);
      // Données ajoutées une image sur deux (30 fois/s) : moins de retraitement des tuiles, halo toujours à 60 i/s.
      if (target > shown && (this.frame % 2 === 0 || target === trace.count)) {
        const feats: any[] = [];
        for (let i = shown; i < target; i++) {
          const line: [number, number][] = [];
          for (let k = trace.offsets[i]; k < trace.offsets[i + 1]; k++) line.push([trace.coords[k * 2], trace.coords[k * 2 + 1]]);
          feats.push({ type: 'Feature', id: i, properties: { c: trace.costs[i], b: this.frame }, geometry: { type: 'LineString', coordinates: line } });
        }
        this.src('wave')?.updateData({ add: feats });
        // Frontière : extrémités des dernières arêtes atteintes.
        const from = Math.max(0, target - Math.max(60, Math.min(260, target - shown)));
        const pts: any[] = [];
        for (let i = from; i < target; i++) pts.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [trace.tips[i * 2], trace.tips[i * 2 + 1]] } });
        this.src('wave-front')?.setData({ type: 'FeatureCollection', features: pts });
        shown = target;
      }
      this.frame++;
      if (this.frame % 6 === 0) this.setAge();
      // Halo qui pulse
      const pulse = (Math.sin(now / 160) + 1) / 2;
      this.map.setPaintProperty('wave-front-halo', 'circle-radius', 6 + pulse * 6);
      this.map.setPaintProperty('wave-front-halo', 'circle-opacity', 0.3 + pulse * 0.3);
      if (now - lastHud > 90) {
        lastHud = now;
        onProgress({ shown, explored: Math.round((shown / trace.count) * trace.explored), elapsed });
      }
      return shown < trace.count;
    });
    onProgress({ shown, explored: trace.explored, elapsed: performance.now() - start });
    this.src('wave-front')?.setData(EMPTY);
    this.setAge();

    // 2. Flash sur B + chemin dessiné de B vers A (1,2 s) + fondu de l'exploration (1 s)
    this.src('wave-flash')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [b.lon, b.lat] } });
    const rev = [...route].reverse();
    const cum = cumulative(rev);
    const total = cum[cum.length - 1];
    const t1 = performance.now();
    await this.loop((now) => {
      const t = Math.max(0, now - t1);
      const f = Math.min(1, t / 600);
      this.map.setPaintProperty('wave-flash', 'circle-radius', 8 + f * 46);
      this.map.setPaintProperty('wave-flash', 'circle-opacity', 0.9 * (1 - f));
      const p = this.skipFlag ? 1 : Math.min(1, Math.max(0, (t - 150) / 1200));
      const d = total * p;
      const line: [number, number][] = [];
      for (let i = 0; i < rev.length && cum[i] <= d; i++) line.push(rev[i]);
      if (p < 1) line.push(pointAt(rev, cum, d));
      if (line.length > 1) this.src('wave-path')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
      this.fade = Math.max(0, 1 - Math.max(0, t - 300) / 1000);
      if (this.frame++ % 2 === 0) this.setAge();
      return t < 1400 && !(this.skipFlag && t > 200);
    });
    this.src('wave-path')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } });
    this.src('wave')?.setData(EMPTY);
    this.src('wave-flash')?.setData(EMPTY);
    this.fade = 1;
    this.setAge();

    // 3. Recadrage doux sur le chemin
    const bounds = route.reduce((bb, c) => bb.extend(c), new LngLatBounds(route[0], route[0]));
    const cam = this.map.cameraForBounds(bounds, { padding: { top: 230, bottom: 300, left: 50, right: 50 }, maxZoom: 16 });
    if (cam) this.map.easeTo({ ...cam, pitch: 35, duration: 900 });
  }

  /** Retour au style normal (navigation). */
  async undim() {
    const t0 = performance.now();
    const from = (this.map.getPaintProperty(DIM, 'background-opacity') as number) || 0;
    await this.loop((now) => {
      const f = Math.min(1, (now - t0) / 400);
      this.map.setPaintProperty(DIM, 'background-opacity', from * (1 - f));
      return f < 1;
    });
  }
}
