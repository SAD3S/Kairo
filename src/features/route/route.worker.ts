/// <reference lib="webworker" />
// Calculs lourds hors du fil de l'interface (équivalent de Dispatchers.Default) :
// construction du graphe, recherche animée par lots, itinéraire final.
import { haversine, LatLon } from './geo';
import { buildGraph, edgeCoords, Graph, nearestNode } from './graph';
import { decodeGraph } from './pack';
import { buildRoute } from './instructions';
import { Algo, shortestPath } from './search';
import type { GraphSlot, WorkerIn, WorkerOut } from './protocol';

const graphs: Record<GraphSlot, Graph | null> = { live: null, pack: null };
let skip = false;
let runId = 0;

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Au-delà de cette distance, le point est jugé hors de la zone téléchargée. */
const SNAP_MAX = 400;

/** Estime le nombre de nœuds que l'algorithme va visiter (pour régler la vitesse de l'animation). */
function estimateVisits(g: Graph, a: LatLon, b: LatLon, algo: Algo): number {
  const d = haversine(a.lat, a.lon, b.lat, b.lon);
  let n = 0;
  for (let i = 0; i < g.nodeCount; i++) {
    const da = haversine(a.lat, a.lon, g.lat[i], g.lon[i]);
    if (algo === 'dijkstra') { if (da <= d) n++; }
    else if (da + haversine(g.lat[i], g.lon[i], b.lat, b.lon) <= d * 1.25) n++;
  }
  return Math.max(50, n);
}

async function run(id: number, algo: Algo, a: LatLon, b: LatLon, durationMs: number, slot: GraphSlot) {
  const g = graphs[slot];
  if (!g) return post({ type: 'error', id, code: 'nograph' });
  const sa = nearestNode(g, a, 'out');
  const sb = nearestNode(g, b, 'in');
  if (!sa || !sb) return post({ type: 'error', id, code: 'noroads' });
  if (sa.distance > SNAP_MAX || sb.distance > SNAP_MAX) return post({ type: 'error', id, code: 'outside', distance: Math.round(Math.max(sa.distance, sb.distance)) });

  skip = durationMs <= 0;
  // Durée cible quelle que soit la taille du graphe : ~30 images/s, lot ajusté à l'estimation.
  const FRAME = 33;
  const frames = Math.max(1, durationMs / FRAME);
  const estimate = skip ? 0 : estimateVisits(g, a, b, algo);
  const batch = skip ? 1e9 : Math.max(1, Math.ceil(estimate / frames));
  const it = shortestPath(g, sa.node, sb.node, algo, batch);
  let last = performance.now();
  for (;;) {
    const r = it.next();
    if (r.done) {
      const res = r.value;
      if (id !== runId) return;
      if (!res.found) return post({ type: 'error', id, code: 'nopath' });
      const plan = buildRoute(g, res, a, b);
      return post({ type: 'done', id, plan, visited: res.visited, algo });
    }
    if (id !== runId) return; // une nouvelle demande a remplacé celle-ci
    if (!skip) {
      post({ type: 'explored', id, lines: r.value.map((e) => edgeCoords(g, e)) });
      // Une image toutes les ~33 ms ; on rend la main pour recevoir « passer ».
      await sleep(Math.max(0, FRAME - (performance.now() - last)));
      last = performance.now();
    }
  }
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  if (m.type === 'graph') {
    try {
      post({ type: 'progress', step: 'build' });
      const g = buildGraph(JSON.parse(m.json));
      graphs.live = g.edgeCount ? g : null;
      if (!graphs.live) return post({ type: 'error', id: 0, code: 'noroads' });
      post({ type: 'graph-ready', nodes: g.nodeCount, edges: g.edgeCount, slot: 'live' });
    } catch {
      graphs.live = null;
      post({ type: 'error', id: 0, code: 'parse' });
    }
  } else if (m.type === 'graph-bin') {
    try {
      post({ type: 'progress', step: 'build' });
      const g = decodeGraph(m.buf);
      graphs.pack = g;
      post({ type: 'graph-ready', nodes: g.nodeCount, edges: g.edgeCount, slot: 'pack' });
    } catch {
      graphs.pack = null;
      post({ type: 'error', id: 0, code: 'parse' });
    }
  } else if (m.type === 'run') {
    runId = m.id;
    run(m.id, m.algo, m.a, m.b, m.durationMs, m.slot);
  } else if (m.type === 'skip') {
    skip = true;
  }
};
