// Côté interface : pilote le worker de calcul et convertit ses messages en promesses.
import { LatLon } from './geo';
import { RoutePlan } from './instructions';
import type { WorkerOut } from './protocol';
import { RouteError } from './repo';
import { Algo } from './search';
import { T } from './strings';

export class OutsideError extends RouteError {}

export class RouteEngine {
  private w = new Worker(new URL('./route.worker.ts', import.meta.url), { type: 'module' });
  private id = 0;
  private handlers = new Set<(m: WorkerOut) => void>();
  graphReady = false;

  constructor() {
    this.w.onmessage = (e: MessageEvent<WorkerOut>) => this.handlers.forEach((h) => h(e.data));
  }

  private listen(h: (m: WorkerOut) => void) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  loadGraph(json: string, onStep?: (s: 'build') => void): Promise<{ nodes: number; edges: number }> {
    this.graphReady = false;
    return new Promise((resolve, reject) => {
      const off = this.listen((m) => {
        if (m.type === 'progress') onStep?.(m.step);
        else if (m.type === 'graph-ready') { off(); this.graphReady = true; resolve(m); }
        else if (m.type === 'error' && m.id === 0) { off(); reject(new RouteError(m.code === 'noroads' ? T.noRoads : T.overpassError)); }
      });
      this.w.postMessage({ type: 'graph', json });
    });
  }

  run(algo: Algo, a: LatLon, b: LatLon, durationMs: number, onExplored?: (lines: [number, number][][]) => void): Promise<{ plan: RoutePlan; visited: number }> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const off = this.listen((m) => {
        if (!('id' in m) || m.id !== id) return;
        if (m.type === 'explored') onExplored?.(m.lines);
        else if (m.type === 'done') { off(); resolve({ plan: m.plan, visited: m.visited }); }
        else if (m.type === 'error') {
          off();
          if (m.code === 'outside') reject(new OutsideError(T.tooFarFromRoad(m.distance ?? 0)));
          else if (m.code === 'nopath') reject(new RouteError(T.noPath));
          else if (m.code === 'noroads') reject(new RouteError(T.noRoads));
          else reject(new RouteError(T.overpassError));
        }
      });
      this.w.postMessage({ type: 'run', id, algo, a, b, durationMs });
    });
  }

  skip() {
    this.w.postMessage({ type: 'skip' });
  }

  dispose() {
    this.w.terminate();
    this.handlers.clear();
  }
}
