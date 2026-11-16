import type { LatLon } from './geo';
import type { RoutePlan } from './instructions';
import type { Algo } from './search';

export type WorkerIn =
  | { type: 'graph'; json: string }
  | { type: 'run'; id: number; algo: Algo; a: LatLon; b: LatLon; durationMs: number }
  | { type: 'skip' };

export type WorkerErrorCode = 'nograph' | 'noroads' | 'outside' | 'nopath' | 'parse';

export type WorkerOut =
  | { type: 'progress'; step: 'build' }
  | { type: 'graph-ready'; nodes: number; edges: number }
  | { type: 'explored'; id: number; lines: [number, number][][] }
  | { type: 'done'; id: number; plan: RoutePlan; visited: number; algo: Algo }
  | { type: 'error'; id: number; code: WorkerErrorCode; distance?: number };
