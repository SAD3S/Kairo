// Dijkstra et A* sur le graphe, sous forme de générateurs : ils rendent la main
// régulièrement avec les arêtes nouvellement explorées (pour l'animation).
import { haversine } from './geo';
import { Graph } from './graph';

export type Algo = 'dijkstra' | 'astar';

export interface SearchResult {
  found: boolean;
  /** Arêtes du chemin, dans l'ordre. */
  edges: number[];
  nodes: number[];
  /** Durée estimée (s) et distance (m). */
  time: number;
  distance: number;
  /** Nombre de nœuds définitivement visités. */
  visited: number;
}

/** Tas binaire minimal (clé, valeur). */
class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

/**
 * Recherche du plus court chemin (en temps).
 * Toutes les `batch` itérations, le générateur produit la liste des arêtes explorées depuis la dernière fois.
 */
export function* shortestPath(g: Graph, source: number, target: number, algo: Algo, batch = 200): Generator<number[], SearchResult, void> {
  const n = g.nodeCount;
  const best = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const h = algo === 'astar'
    ? (i: number) => haversine(g.lat[i], g.lon[i], g.lat[target], g.lon[target]) / g.vmax
    : () => 0;

  const heap = new MinHeap();
  best[source] = 0;
  heap.push(h(source), source);
  let explored: number[] = [];
  let visited = 0;
  let iter = 0;

  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    visited++;
    if (u === target) break;
    for (let e = g.first[u]; e < g.first[u + 1]; e++) {
      const v = g.to[e];
      if (done[v]) continue;
      explored.push(e);
      const nd = best[u] + g.cost[e];
      if (nd < best[v]) {
        best[v] = nd;
        prevEdge[v] = e;
        heap.push(nd + h(v), v);
      }
    }
    if (++iter % batch === 0 && explored.length) {
      yield explored;
      explored = [];
    }
  }
  if (explored.length) yield explored;

  if (!done[target] || best[target] === Infinity) return { found: false, edges: [], nodes: [], time: 0, distance: 0, visited };
  const edges: number[] = [];
  let cur = target;
  while (cur !== source) {
    const e = prevEdge[cur];
    edges.push(e);
    cur = g.from[e];
  }
  edges.reverse();
  const nodes = [source, ...edges.map((e) => g.to[e])];
  let distance = 0;
  for (const e of edges) distance += g.length[e];
  return { found: true, edges, nodes, time: best[target], distance, visited };
}

/** Exécute la recherche d'un coup (sans animation). */
export function runToEnd(g: Graph, source: number, target: number, algo: Algo): SearchResult {
  const it = shortestPath(g, source, target, algo, 1e9);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
