/// <reference lib="webworker" />
// Calculs lourds hors du fil de l'interface (équivalent de Dispatchers.Default) :
// construction du graphe, recherche animée par lots, itinéraire final.
import { LatLon } from './geo';
import { buildGraph, edgeCoords, Graph, nearestNode } from './graph';
import { buildRoute } from './instructions';
import { Algo, shortestPath } from './search';
import type { WorkerIn, WorkerOut } from './protocol';

let graph: Graph | null = null;
let skip = false;
let runId = 0;

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Au-delà de cette distance, le point est jugé hors de la zone téléchargée. */
const SNAP_MAX = 400;

async function run(id: number, algo: Algo, a: LatLon, b: LatLon, durationMs: number) {
  const g = graph;
  if (!g) return post({ type: 'error', id, code: 'nograph' });
  const sa = nearestNode(g, a, 'out');
  const sb = nearestNode(g, b, 'in');
  if (!sa || !sb) return post({ type: 'error', id, code: 'noroads' });
  if (sa.distance > SNAP_MAX || sb.distance > SNAP_MAX) return post({ type: 'error', id, code: 'outside', distance: Math.round(Math.max(sa.distance, sb.distance)) });

  skip = durationMs <= 0;
  // Durée cible quelle que soit la taille du graphe : ~30 images/s, lot ajusté à l'estimation.
  const FRAME = 33;
  const frames = Math.max(1, durationMs / FRAME);
  const estimate = algo === 'astar' ? g.nodeCount * 0.3 : g.nodeCount * 0.6;
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
      graph = buildGraph(JSON.parse(m.json));
      if (!graph.edgeCount) {
        graph = null;
        return post({ type: 'error', id: 0, code: 'noroads' });
      }
      post({ type: 'graph-ready', nodes: graph.nodeCount, edges: graph.edgeCount });
    } catch {
      graph = null;
      post({ type: 'error', id: 0, code: 'parse' });
    }
  } else if (m.type === 'run') {
    runId = m.id;
    run(m.id, m.algo, m.a, m.b, m.durationMs);
  } else if (m.type === 'skip') {
    skip = true;
  }
};
