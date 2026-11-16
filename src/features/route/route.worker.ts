/// <reference lib="webworker" />
// Calculs lourds hors du fil de l'interface (équivalent de Dispatchers.Default) :
// construction du graphe, recherche animée par lots, itinéraire final.
import { LatLon } from './geo';
import { buildGraph, Graph, nearestNode } from './graph';
import { TraceRecorder } from './trace';
import { decodeGraph } from './pack';
import { buildRoute } from './instructions';
import { Algo, shortestPath } from './search';
import type { GraphSlot, WorkerIn, WorkerOut } from './protocol';

const graphs: Record<GraphSlot, Graph | null> = { live: null, pack: null };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
/** Au-delà de cette distance, le point est jugé hors de la zone téléchargée. */
const SNAP_MAX = 400;

function run(id: number, algo: Algo, a: LatLon, b: LatLon, slot: GraphSlot, wantTrace: boolean) {
  const g = graphs[slot];
  if (!g) return post({ type: 'error', id, code: 'nograph' });
  const sa = nearestNode(g, a, 'out');
  const sb = nearestNode(g, b, 'in');
  if (!sa || !sb) return post({ type: 'error', id, code: 'noroads' });
  if (sa.distance > SNAP_MAX || sb.distance > SNAP_MAX) return post({ type: 'error', id, code: 'outside', distance: Math.round(Math.max(sa.distance, sb.distance)) });

  // L'algorithme tourne d'un coup (quelques dizaines de ms) ; l'animation le rejoue ensuite côté carte.
  const t0 = performance.now();
  const rec = wantTrace ? new TraceRecorder() : null;
  const it = shortestPath(g, sa.node, sb.node, algo, 500);
  for (;;) {
    const r = it.next();
    if (!r.done) { rec?.add(r.value); continue; }
    const res = r.value;
    if (!res.found) return post({ type: 'error', id, code: 'nopath' });
    const plan = buildRoute(g, res, a, b);
    const ms = performance.now() - t0;
    const trace = rec?.build(g, res.time);
    const transfer = trace ? [trace.coords.buffer, trace.offsets.buffer, trace.costs.buffer, trace.tips.buffer] : [];
    return (self as unknown as Worker).postMessage({ type: 'done', id, plan, visited: res.visited, algo, ms, trace } satisfies WorkerOut, transfer);
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
    run(m.id, m.algo, m.a, m.b, m.slot, m.trace);
  }
};
