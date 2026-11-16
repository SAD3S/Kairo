// Suivi de la navigation à partir des positions GPS (pur, testable sans Android).
import { haversine, LatLon, projectOnSegment } from './geo';
import { Maneuver, RoutePlan, spokenAnnouncement } from './instructions';

export const ANNOUNCE_AT = [500, 200, 50] as const;
export const NOW_AT = 15;
export const OFF_ROUTE_M = 40;
export const OFF_ROUTE_MS = 5000;
export const ARRIVE_M = 20;

export interface NavUpdate {
  /** Position recalée sur le tracé. */
  snapped: LatLon;
  /** Distance parcourue le long du tracé (m). */
  along: number;
  /** Distance au tracé (m). */
  offset: number;
  next: Maneuver | null;
  nextIndex: number;
  distToNext: number;
  remaining: number;
  /** Phrase à prononcer maintenant (une seule fois par seuil). */
  speak?: string;
  /** Vrai quand il faut recalculer l'itinéraire (hors route depuis > 5 s). */
  reroute: boolean;
  arrived: boolean;
  /** Cap du tracé à cet endroit (°), pour orienter la carte. */
  routeBearing: number;
}

export class NavTracker {
  private seg = 0;
  private spoken = new Set<string>();
  private offSince: number | null = null;
  private arrivedDone = false;

  constructor(private plan: RoutePlan) {}

  private project(p: LatLon): { d: number; seg: number; along: number; point: LatLon } {
    const c = this.plan.coords;
    const pt = (i: number) => ({ lat: c[i][1], lon: c[i][0] });
    let best = { d: Infinity, seg: this.seg, along: 0, point: p };
    // Fenêtre autour du dernier segment connu, puis tout le tracé si on s'en est éloigné.
    const scan = (from: number, to: number) => {
      for (let i = Math.max(0, from); i < Math.min(c.length - 1, to); i++) {
        const r = projectOnSegment(p, pt(i), pt(i + 1));
        if (r.d < best.d) {
          const along = this.plan.cum[i] + (this.plan.cum[i + 1] - this.plan.cum[i]) * r.t;
          best = { d: r.d, seg: i, along, point: r.point };
        }
      }
    };
    scan(this.seg - 5, this.seg + 60);
    if (best.d > OFF_ROUTE_M) scan(0, c.length);
    return best;
  }

  update(p: LatLon, nowMs: number): NavUpdate {
    const pr = this.project(p);
    this.seg = pr.seg;
    const total = this.plan.distance;
    const maneuvers = this.plan.maneuvers;
    let nextIndex = maneuvers.findIndex((m, i) => i > 0 && m.at > pr.along + 2);
    if (nextIndex < 0) nextIndex = maneuvers.length - 1;
    const next = maneuvers[nextIndex] ?? null;
    const distToNext = next ? Math.max(0, next.at - pr.along) : 0;

    // Hors route : plus de 40 m du tracé pendant plus de 5 s.
    let reroute = false;
    if (pr.d > OFF_ROUTE_M) {
      if (this.offSince === null) this.offSince = nowMs;
      else if (nowMs - this.offSince > OFF_ROUTE_MS) {
        reroute = true;
        this.offSince = null;
      }
    } else {
      this.offSince = null;
    }

    // Arrivée : à moins de 20 m de B.
    const end = this.plan.coords[this.plan.coords.length - 1];
    const toEnd = haversine(p.lat, p.lon, end[1], end[0]);
    let arrived = false;
    let speak: string | undefined;
    if (toEnd < ARRIVE_M && !this.arrivedDone) {
      this.arrivedDone = true;
      arrived = true;
      speak = spokenAnnouncement(maneuvers[maneuvers.length - 1], 'now');
    } else if (next && !reroute && pr.d <= OFF_ROUTE_M && !this.arrivedDone) {
      speak = this.announcement(nextIndex, next, distToNext);
    }

    const c = this.plan.coords;
    const a = c[pr.seg];
    const b = c[Math.min(pr.seg + 1, c.length - 1)];
    const routeBearing = (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;

    return {
      snapped: pr.point,
      along: pr.along,
      offset: pr.d,
      next,
      nextIndex,
      distToNext,
      remaining: Math.max(0, total - pr.along),
      speak,
      reroute,
      arrived: arrived || this.arrivedDone,
      routeBearing: (routeBearing + 360) % 360,
    };
  }

  /** Une annonce par seuil (500, 200, 50 m, puis « maintenant »), jamais répétée. */
  private announcement(i: number, m: Maneuver, d: number): string | undefined {
    if (m.type === 'arrive') {
      // Pour l'arrivée, on ne fait que les annonces à distance ; « Vous êtes arrivé » est géré à part.
      if (d <= NOW_AT) return undefined;
    }
    if (d <= NOW_AT) return this.once(`${i}:now`, () => spokenAnnouncement(m, 'now'));
    const thresholds = [...ANNOUNCE_AT].sort((a, b) => a - b); // 50, 200, 500
    for (const t of thresholds) {
      if (d <= t) {
        // Seuil le plus proche franchi ; les seuils plus grands sont considérés comme passés.
        thresholds.filter((x) => x > t).forEach((x) => this.spoken.add(`${i}:${x}`));
        return this.once(`${i}:${t}`, () => spokenAnnouncement(m, d > t * 0.8 ? t : d));
      }
    }
    return undefined;
  }

  private once(key: string, text: () => string): string | undefined {
    if (this.spoken.has(key)) return undefined;
    this.spoken.add(key);
    return text();
  }
}
