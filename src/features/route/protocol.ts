import type { LatLon } from './geo';
import type { RoutePlan } from './instructions';
import type { Algo } from './search';
import type { Trace } from './trace';

export type GraphSlot = 'live' | 'pack';

export type WorkerIn =
  | { type: 'graph'; json: string }
  | { type: 'graph-bin'; buf: ArrayBuffer }
  | { type: 'run'; id: number; algo: Algo; a: LatLon; b: LatLon; slot: GraphSlot; trace: boolean };

export type WorkerErrorCode = 'nograph' | 'noroads' | 'outside' | 'nopath' | 'parse';

export type WorkerOut =
  | { type: 'progress'; step: 'build' }
  | { type: 'graph-ready'; nodes: number; edges: number; slot: GraphSlot }
  | { type: 'done'; id: number; plan: RoutePlan; visited: number; algo: Algo; ms: number; trace?: Trace }
  | { type: 'error'; id: number; code: WorkerErrorCode; distance?: number };
