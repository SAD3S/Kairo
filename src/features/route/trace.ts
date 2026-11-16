// Enregistrement de l'exploration pour la rejouer en animation (pur, testable).
// L'algorithme tourne d'un coup ; on garde l'ordre d'exploration, la géométrie et le coût de chaque arête.
import { edgeCoords, Graph } from './graph';
import { ExploredBatch } from './search';

/** Au-delà, on échantillonne : l'effet visuel est identique et le téléphone reste fluide. */
export const MAX_TRACE_EDGES = 40000;

export interface Trace {
  /** Points [lon, lat] à plat ; l'arête i occupe les points offsets[i] … offsets[i+1]-1. */
  coords: Float32Array;
  offsets: Int32Array;
  /** Coût depuis A, normalisé par la durée du trajet final (0 = A, 1 = B). */
  costs: Float32Array;
  /** Extrémité de chaque arête (pour dessiner la frontière). */
  tips: Float32Array;
  count: number;
  /** Nombre total d'arêtes explorées (avant échantillonnage). */
  explored: number;
}

export class TraceRecorder {
  private edges: number[] = [];
  private costs: number[] = [];
  add(b: ExploredBatch) {
    for (let i = 0; i < b.edges.length; i++) {
      this.edges.push(b.edges[i]);
      this.costs.push(b.costs[i]);
    }
  }

  build(g: Graph, finalTime: number): Trace {
    const total = this.edges.length;
    const step = Math.max(1, Math.ceil(total / MAX_TRACE_EDGES));
    // Échantillonné : segments droits (2 points) ; sinon géométrie complète de la rue.
    const full = step === 1;
    const keep: number[] = [];
    for (let i = 0; i < total; i += step) keep.push(i);
    const pts: number[] = [];
    const offsets = new Int32Array(keep.length + 1);
    const costs = new Float32Array(keep.length);
    const tips = new Float32Array(keep.length * 2);
    const norm = finalTime > 0 ? finalTime : Math.max(1, ...this.costs.slice(-50));
    keep.forEach((i, k) => {
      const e = this.edges[i];
      offsets[k] = pts.length / 2;
      if (full) for (const [x, y] of edgeCoords(g, e)) pts.push(x, y);
      else pts.push(g.lon[g.from[e]], g.lat[g.from[e]], g.lon[g.to[e]], g.lat[g.to[e]]);
      costs[k] = Math.min(1, this.costs[i] / norm);
      tips[k * 2] = g.lon[g.to[e]];
      tips[k * 2 + 1] = g.lat[g.to[e]];
    });
    offsets[keep.length] = pts.length / 2;
    return { coords: Float32Array.from(pts), offsets, costs, tips, count: keep.length, explored: total };
  }
}

/** Courbe ease-in-out (cubique) : départ et fin en douceur. */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Nombre d'arêtes à afficher après `elapsed` ms sur une animation de `duration` ms. */
export function shownAt(count: number, elapsed: number, duration: number): number {
  if (duration <= 0) return count;
  return Math.round(count * easeInOut(Math.max(0, Math.min(1, elapsed / duration))));
}
