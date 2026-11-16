// Côté interface : pilote le worker de calcul et convertit ses messages en promesses.
import { LatLon } from './geo';
import { RoutePlan } from './instructions';
import type { GraphSlot, WorkerOut } from './protocol';
import { RouteError } from './repo';
import { Algo } from './search';
import type { Trace } from './trace';
import { T } from './strings';

export class OutsideError extends RouteError {}

export class RouteEngine {
  private w = new Worker(new URL('./route.worker.ts', import.meta.url), { type: 'module' });
  private id = 0;
  private handlers = new Set<(m: WorkerOut) => void>();
  ready: Record<GraphSlot, boolean> = { live: false, pack: false };

  constructor() {
    this.w.onmessage = (e: MessageEvent<WorkerOut>) => this.handlers.forEach((h) => h(e.data));
  }

  private listen(h: (m: WorkerOut) => void) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  private load(slot: GraphSlot, msg: any, transfer: Transferable[] = []): Promise<{ nodes: number; edges: number }> {
    this.ready[slot] = false;
    return new Promise((resolve, reject) => {
      const off = this.listen((m) => {
        if (m.type === 'graph-ready' && m.slot === slot) { off(); this.ready[slot] = true; resolve(m); }
        else if (m.type === 'error' && m.id === 0) { off(); reject(new RouteError(m.code === 'noroads' ? T.noRoads : T.overpassError)); }
      });
      this.w.postMessage(msg, transfer);
    });
  }

  /** Graphe téléchargé depuis Overpass (JSON). */
  loadGraph(json: string) {
    return this.load('live', { type: 'graph', json });
  }

  /** Graphe du pack hors ligne (binaire, transféré sans copie). */
  loadPackGraph(buf: ArrayBuffer) {
    return this.load('pack', { type: 'graph-bin', buf }, [buf]);
  }

  run(algo: Algo, a: LatLon, b: LatLon, slot: GraphSlot, withTrace = false): Promise<{ plan: RoutePlan; visited: number; ms: number; trace?: Trace }> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const off = this.listen((m) => {
        if (!('id' in m) || m.id !== id) return;
        if (m.type === 'done') { off(); resolve({ plan: m.plan, visited: m.visited, ms: m.ms, trace: m.trace }); }
        else if (m.type === 'error') {
          off();
          if (m.code === 'outside') reject(new OutsideError(T.tooFarFromRoad(m.distance ?? 0)));
          else if (m.code === 'nopath') reject(new RouteError(T.noPath));
          else if (m.code === 'noroads') reject(new RouteError(T.noRoads));
          else reject(new RouteError(T.overpassError));
        }
      });
      this.w.postMessage({ type: 'run', id, algo, a, b, slot, trace: withTrace });
    });
  }

  dispose() {
    this.w.terminate();
    this.handlers.clear();
  }
}

/** Un seul moteur pour toute l'app : le graphe hors ligne reste en mémoire entre deux ouvertures de l'écran. */
let shared: RouteEngine | null = null;
export const sharedEngine = () => (shared ??= new RouteEngine());
