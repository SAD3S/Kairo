import { describe, expect, it } from 'vitest';
import { bboxAround, bearing, haversine, turnAngle } from '../geo';
import { buildGraph, nearestNode, onewayOf, parseMaxspeed } from '../graph';
import { runToEnd, shortestPath } from '../search';
import { buildManeuvers, buildRoute, classifyTurn, cumulative, maneuverText, spokenAnnouncement } from '../instructions';
import { NavTracker } from '../tracker';

// Petite ville en grille : rues horizontales (lat) et verticales (lon), espacées de ~110 m.
const STEP = 0.001;
function grid(n = 6, extra: any[] = []) {
  const elements: any[] = [];
  const id = (r: number, c: number) => 1 + r * 100 + c;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) elements.push({ type: 'node', id: id(r, c), lat: 48.85 + r * STEP, lon: 2.35 + c * STEP });
  let w = 1000;
  for (let r = 0; r < n; r++) elements.push({ type: 'way', id: w++, nodes: Array.from({ length: n }, (_, c) => id(r, c)), tags: { highway: 'residential', name: `Rue ${r}` } });
  for (let c = 0; c < n; c++) elements.push({ type: 'way', id: w++, nodes: Array.from({ length: n }, (_, r) => id(r, c)), tags: { highway: 'residential', name: `Avenue ${c}` } });
  return { elements: [...elements, ...extra], id };
}

describe('géométrie', () => {
  it('haversine ≈ 111 m pour 0,001° de latitude', () => {
    expect(haversine(48.85, 2.35, 48.851, 2.35)).toBeCloseTo(111.2, 0);
  });
  it('caps et virages', () => {
    expect(bearing(48.85, 2.35, 48.851, 2.35)).toBeCloseTo(0, 1);
    expect(bearing(48.85, 2.35, 48.85, 2.351)).toBeCloseTo(90, 0);
    expect(turnAngle(0, 90)).toBe(90);
    expect(turnAngle(350, 10)).toBe(20);
    expect(turnAngle(10, 350)).toBe(-20);
    expect(turnAngle(0, 180)).toBe(180);
  });
  it('bbox avec marge de 20 %', () => {
    const b = bboxAround([{ lat: 48, lon: 2 }, { lat: 49, lon: 3 }], 0.2);
    expect(b.south).toBeCloseTo(47.8);
    expect(b.east).toBeCloseTo(3.2);
  });
});

describe('graphe', () => {
  it('vitesses, sens uniques', () => {
    expect(parseMaxspeed('50')).toBe(50);
    expect(parseMaxspeed('30 mph')).toBeCloseTo(48.3, 0);
    expect(parseMaxspeed('FR:urban')).toBe(50);
    expect(onewayOf({ highway: 'primary', oneway: 'yes' })).toBe(1);
    expect(onewayOf({ highway: 'primary', oneway: '-1' })).toBe(-1);
    expect(onewayOf({ highway: 'primary', junction: 'roundabout' })).toBe(1);
    expect(onewayOf({ highway: 'motorway' })).toBe(1);
    expect(onewayOf({ highway: 'residential' })).toBe(0);
  });
  it('intersections uniquement, voies piétonnes exclues', () => {
    const id = (r: number, c: number) => 1 + r * 100 + c;
    const { elements } = grid(3, [
      { type: 'node', id: 900, lat: 48.8505, lon: 2.3505 },
      { type: 'way', id: 9, nodes: [id(0, 0), 900, id(1, 1)], tags: { highway: 'footway' } },
    ]);
    const g = buildGraph({ elements });
    expect(g.nodeCount).toBe(9);
    expect(g.edgeCount).toBe(24); // 12 tronçons, double sens
    expect(Array.from(g.lat)).not.toContain(48.8505);
  });
  it('rattache au nœud le plus proche', () => {
    const g = buildGraph(grid(3));
    const r = nearestNode(g, { lat: 48.8509, lon: 2.3511 })!;
    expect(g.lat[r.node]).toBeCloseTo(48.851);
    expect(g.lon[r.node]).toBeCloseTo(2.351);
  });
});

describe('Dijkstra et A*', () => {
  const g = buildGraph(grid(8));
  const src = nearestNode(g, { lat: 48.85, lon: 2.35 })!.node;
  const dst = nearestNode(g, { lat: 48.857, lon: 2.357 })!.node;

  it('trouvent le même coût optimal ; A* visite moins de nœuds', () => {
    const d = runToEnd(g, src, dst, 'dijkstra');
    const a = runToEnd(g, src, dst, 'astar');
    expect(d.found && a.found).toBe(true);
    expect(a.time).toBeCloseTo(d.time, 6);
    expect(d.distance).toBeCloseTo(7 * 111.2 + 7 * 73.2, -1); // chemin Manhattan (0,001° de longitude ≈ 73 m ici)
    expect(a.visited).toBeLessThan(d.visited);
  });
  it('renvoie les arêtes explorées par lots', () => {
    const it = shortestPath(g, src, dst, 'dijkstra', 5);
    let batches = 0;
    let r = it.next();
    while (!r.done) { batches++; expect(r.value.length).toBeGreaterThan(0); r = it.next(); }
    expect(batches).toBeGreaterThan(3);
    expect(r.value.found).toBe(true);
  });
  it('respecte un sens unique : détour obligatoire', () => {
    // Deux nœuds reliés par une rue à sens unique A→B ; B→A doit faire le tour.
    const els = [
      { type: 'node', id: 1, lat: 0, lon: 0 }, { type: 'node', id: 2, lat: 0, lon: 0.001 },
      { type: 'node', id: 3, lat: 0.001, lon: 0.001 }, { type: 'node', id: 4, lat: 0.001, lon: 0 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential', oneway: 'yes' } },
      { type: 'way', id: 11, nodes: [2, 3, 4, 1], tags: { highway: 'residential' } },
    ];
    const gg = buildGraph({ elements: els as any });
    const n1 = nearestNode(gg, { lat: 0, lon: 0 })!.node;
    const n2 = nearestNode(gg, { lat: 0, lon: 0.001 })!.node;
    expect(runToEnd(gg, n1, n2, 'astar').distance).toBeCloseTo(111.3, 0);
    expect(runToEnd(gg, n2, n1, 'dijkstra').distance).toBeGreaterThan(300);
  });
  it('aucun chemin', () => {
    const els = [
      { type: 'node', id: 1, lat: 0, lon: 0 }, { type: 'node', id: 2, lat: 0, lon: 0.001 },
      { type: 'node', id: 3, lat: 1, lon: 1 }, { type: 'node', id: 4, lat: 1, lon: 1.001 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
      { type: 'way', id: 11, nodes: [3, 4], tags: { highway: 'residential' } },
    ];
    const gg = buildGraph({ elements: els as any });
    expect(runToEnd(gg, 0, 2, 'astar').found).toBe(false);
  });
});

describe('instructions', () => {
  it('seuils de virage', () => {
    expect(classifyTurn(10)).toBeNull();
    expect(classifyTurn(-19)).toBeNull();
    expect(classifyTurn(30)).toBe('slight-right');
    expect(classifyTurn(-45)).toBe('slight-left');
    expect(classifyTurn(90)).toBe('right');
    expect(classifyTurn(-120)).toBe('left');
    expect(classifyTurn(170)).toBe('uturn');
  });
  it('itinéraire en L : un seul « tournez à droite » avec le nom de rue', () => {
    const g = buildGraph(grid(6));
    const src = nearestNode(g, { lat: 48.85, lon: 2.35 })!.node; // coin sud-ouest
    const dst = nearestNode(g, { lat: 48.855, lon: 2.35 })!.node; // tout droit vers le nord…
    // On force un trajet nord puis est : départ (0,0) → (3,0) → (3,4)
    const dst2 = nearestNode(g, { lat: 48.853, lon: 2.354 })!.node;
    const r1 = runToEnd(g, src, dst, 'astar');
    const plan1 = buildRoute(g, r1);
    expect(plan1.maneuvers.map((m) => m.type)).toEqual(['depart', 'arrive']);
    const r2 = runToEnd(g, src, dst2, 'astar');
    const plan2 = buildRoute(g, r2);
    const turns = plan2.maneuvers.filter((m) => m.type !== 'depart' && m.type !== 'arrive');
    expect(turns.length).toBeGreaterThanOrEqual(1);
    expect(['right', 'left']).toContain(turns[0].type);
    expect(maneuverText(turns[0])).toMatch(/^Tournez à (droite|gauche) sur (Rue|Avenue) \d$/);
  });
  it('fusionne deux petits décalages successifs en un seul virage', () => {
    // Tracé : nord 200 m, puis deux crochets de 45° à droite à 10 m d'intervalle, puis est.
    const coords: [number, number][] = [[0, 0], [0, 0.0018], [0.00006, 0.00186], [0.0002, 0.00186], [0.002, 0.00186]];
    const cum = cumulative(coords);
    const m = buildManeuvers(coords, cum, [{ at: cum[1] }, { at: cum[2], street: 'rue X' }]);
    const turns = m.filter((x) => x.type !== 'depart' && x.type !== 'arrive');
    expect(turns).toHaveLength(1);
    expect(turns[0].type).toBe('right');
    expect(turns[0].street).toBe('rue X');
  });
  it('textes parlés', () => {
    const m = { type: 'right' as const, angle: 90, at: 100, lat: 0, lon: 0, street: 'rue de la Paix' };
    expect(spokenAnnouncement(m, 100)).toBe('Dans 100 mètres, tournez à droite sur rue de la Paix');
    expect(spokenAnnouncement(m, 'now')).toBe('Tournez maintenant à droite sur rue de la Paix');
    expect(spokenAnnouncement({ ...m, type: 'uturn', street: undefined }, 'now')).toBe('Faites demi-tour maintenant');
  });
});

describe('suivi de navigation', () => {
  // Ligne droite vers le nord de ~1,1 km puis virage à droite.
  const coords: [number, number][] = [[2.35, 48.85], [2.35, 48.86], [2.36, 48.86]];
  const cum = cumulative(coords);
  const plan = { coords, cum, maneuvers: buildManeuvers(coords, cum, [{ at: cum[1], street: 'rue Est' }]), distance: cum[2], time: 300 };
  const at = (lat: number, lon = 2.35) => ({ lat, lon });

  it('annonces 500, 200, 50 m puis maintenant, une seule fois chacune', () => {
    const t = new NavTracker(plan);
    const said: string[] = [];
    for (let lat = 48.85; lat <= 48.86; lat += 0.0001) {
      const u = t.update(at(lat), 0);
      if (u.speak) said.push(u.speak);
    }
    expect(said).toEqual([
      'Dans 500 mètres, tournez à droite sur rue Est',
      'Dans 200 mètres, tournez à droite sur rue Est',
      'Dans 50 mètres, tournez à droite sur rue Est',
      'Tournez maintenant à droite sur rue Est',
    ]);
  });
  it('recalcul après 5 s à plus de 40 m', () => {
    const t = new NavTracker(plan);
    expect(t.update(at(48.852, 2.351), 0).reroute).toBe(false); // ~73 m à l'est
    expect(t.update(at(48.852, 2.351), 3000).reroute).toBe(false);
    expect(t.update(at(48.852, 2.351), 6000).reroute).toBe(true);
    expect(t.update(at(48.852), 7000).reroute).toBe(false); // de retour sur le tracé
  });
  it('arrivée à moins de 20 m', () => {
    const t = new NavTracker(plan);
    t.update(at(48.86, 2.359), 0);
    const u = t.update(at(48.86, 2.35985), 1000);
    expect(u.arrived).toBe(true);
    expect(u.speak).toBe('Vous êtes arrivé');
    expect(t.update(at(48.86, 2.3599), 2000).speak).toBeUndefined();
  });
});
