// Rendu de la recherche en « onde lumineuse » (couche d'affichage seulement, l'algorithme n'est pas touché).
// Une seule source GeoJSON enrichie par ajouts à chaque image (updateData), couches créées une fois.
import { GeoJSONSource, LngLatBounds, Map as MlMap } from 'maplibre-gl';
import { LatLon } from './geo';
import { cumulative, pointAt } from './instructions';
import { shownAt, Trace } from './trace';

/** Palette : cyan → violet de l'app (#8B8CF8) → magenta. */
export const WAVE = { start: '#00E5FF', mid: '#8B8CF8', end: '#FF2D95', path: '#00FF9C', };
const EMPTY: any = { type: 'FeatureCollection', features: [] };
const DIM = 'wave-dim';

const GLOW_W: any = ['interpolate', ['exponential', 1.5], ['zoom'], 9, 2, 12, 5, 14, 9, 17, 14];
const GLOW_BLUR: any = ['interpolate', ['linear'], ['zoom'], 9, 1.5, 12, 3.5, 14, 6, 17, 9];
const CORE_W: any = ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.6, 12, 1.2, 14, 2, 17, 3];
const colorBy = ['interpolate', ['linear'], ['get', 'c'], 0, WAVE.start, 0.5, WAVE.mid, 1, WAVE.end];

export interface WaveProgress {
  shown: number;
  explored: number;
  elapsed: number;
}

export class Wave {
  private raf = 0;
  private skipFlag = false;
  private fade = 1;

  constructor(private map: MlMap, private darkBase: boolean) {
    const add = (id: string) => map.addSource(id, { type: 'geojson', data: EMPTY });
    // Voile qui assombrit et désature le fond pendant la recherche (instantané : pas de changement de style).
    map.addLayer({ id: DIM, type: 'background', paint: { 'background-color': '#05060C', 'background-opacity': 0 } });
    add('wave');
    map.addLayer({ id: 'wave-glow', type: 'line', source: 'wave', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colorBy as any, 'line-width': GLOW_W, 'line-blur': GLOW_BLUR, 'line-opacity': 0 } });
    map.addLayer({ id: 'wave-core', type: 'line', source: 'wave', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colorBy as any, 'line-width': CORE_W, 'line-opacity': 0 } });
    add('wave-path');
    map.addLayer({ id: 'wave-path-glow', type: 'line', source: 'wave-path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': WAVE.path, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 8, 14, 16, 18, 26] as any, 'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 10, 18, 14] as any, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'wave-path', type: 'line', source: 'wave-path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': WAVE.path, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 3, 14, 6, 18, 9] as any } });
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

  /**
   * Révèle les `shown` premières arêtes : opacité selon leur âge (récentes à fond, anciennes vers 0,25).
   * Seule une expression de style change à chaque image ; les données ne sont jamais renvoyées.
   */
  private reveal(shown: number, span: number) {
    const age = ['-', shown, ['get', 'o']];
    const op = (hi: number, lo: number) => ['case', ['<', ['get', 'o'], shown], ['*', this.fade, ['interpolate', ['linear'], age, 0, hi, span, lo]], 0];
    this.map.setPaintProperty('wave-core', 'line-opacity', op(1, 0.25) as any);
    this.map.setPaintProperty('wave-glow', 'line-opacity', op(0.5, 0.15) as any);
  }

  /** Efface tout (exploration, chemin, voile). */
  clear() {
    cancelAnimationFrame(this.raf);
    this.skipFlag = false;
    for (const id of ['wave', 'wave-path', 'wave-flash']) this.src(id)?.setData(EMPTY);
    this.setDim(0);
  }

  skip() {
    this.skipFlag = true;
  }

  /** Caméra inclinée à 50°, cadrée sur A–B. */
  frame50(a: LatLon, b: LatLon) {
    const bounds = new LngLatBounds([a.lon, a.lat], [a.lon, a.lat]).extend([b.lon, b.lat]);
    const cam = this.map.cameraForBounds(bounds, { padding: { top: 230, bottom: 260, left: 50, right: 50 }, maxZoom: 15 });
    if (cam) this.map.easeTo({ ...cam, pitch: 50, bearing: 0, duration: 800, easing: (t) => 1 - Math.pow(1 - t, 3) });
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
  /** Attend la fin d'un mouvement de caméra (ou rien s'il n'y en a pas). */
  private cameraIdle() {
    return new Promise<void>((resolve) => {
      if (!this.map.isMoving()) return resolve();
      this.map.once('moveend', () => resolve());
    });
  }

  /** Rejoue l'exploration en `duration` ms (courbe ease-in-out), puis la fin : flash sur B, chemin de B vers A, recadrage. */
  async play(trace: Trace, duration: number, route: [number, number][], b: LatLon, onProgress: (p: WaveProgress) => void) {
    this.clear();
    this.fade = 1;
    // Toutes les arêtes envoyées d'un coup (invisibles), pendant que la caméra s'incline.
    const feats: any[] = new Array(trace.count);
    for (let i = 0; i < trace.count; i++) {
      const line: [number, number][] = [];
      for (let k = trace.offsets[i]; k < trace.offsets[i + 1]; k++) line.push([trace.coords[k * 2], trace.coords[k * 2 + 1]]);
      feats[i] = { type: 'Feature', properties: { c: trace.costs[i], o: i }, geometry: { type: 'LineString', coordinates: line } };
    }
    this.reveal(0, 1);
    await Promise.all([this.src('wave')?.setData({ type: 'FeatureCollection', features: feats }), this.cameraIdle()]);
    // Âge : une arête pâlit sur ~15 % de l'animation.
    const span = Math.max(30, trace.count * 0.15);
    const start = performance.now();
    let shown = 0;
    let lastHud = 0;
    let frame = 0;

    // 1. Exploration
    await this.loop((now) => {
      const elapsed = Math.max(0, now - start);
      this.setDim(Math.min(1, elapsed / 400));
      const target = this.skipFlag ? trace.count : shownAt(trace.count, elapsed, duration);
      // Révélation ~30 fois/s (une image sur deux) : moitié moins de mises à jour pour le GPU, croissance toujours continue.
      if (target !== shown && ((frame++ & 1) === 0 || target === trace.count)) {
        shown = target;
        this.reveal(shown, span);
      }
      if (now - lastHud > 90) {
        lastHud = now;
        onProgress({ shown, explored: Math.round((shown / trace.count) * trace.explored), elapsed });
      }
      return shown < trace.count;
    });
    onProgress({ shown, explored: trace.explored, elapsed: performance.now() - start });

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
      this.reveal(trace.count, span);
      return t < 1400 && !(this.skipFlag && t > 200);
    });
    this.src('wave-path')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } });
    this.src('wave')?.setData(EMPTY);
    this.src('wave-flash')?.setData(EMPTY);
    this.fade = 1;

    // 3. Recadrage doux sur le chemin
    const bounds = route.reduce((bb, c) => bb.extend(c), new LngLatBounds(route[0], route[0]));
    const cam = this.map.cameraForBounds(bounds, { padding: { top: 230, bottom: 300, left: 50, right: 50 }, maxZoom: 16 });
    // Recadrage lent et doux, sans changer d'inclinaison (évite l'effet « saut » de zoom).
    if (cam) this.map.easeTo({ ...cam, pitch: this.map.getPitch(), bearing: this.map.getBearing(), duration: 1400, easing: (t) => 1 - Math.pow(1 - t, 3) });
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
