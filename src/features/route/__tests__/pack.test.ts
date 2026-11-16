import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildGraph, nearestNode } from '../graph';
import { decodeGraph, insidePack, OfflineIndex, PlaceRow } from '../pack';
import { runToEnd } from '../search';

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const bin = gunzipSync(fx('graph.bin.gz'));
const packed = decodeGraph(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const live = buildGraph(JSON.parse(fx('mini.overpass.json').toString()));

describe('pack hors ligne : graphe binaire', () => {
  it('Python et l’app construisent le même graphe', () => {
    expect(packed.nodeCount).toBe(live.nodeCount);
    expect(packed.edgeCount).toBe(live.edgeCount);
    expect(Array.from(packed.first)).toEqual(Array.from(live.first));
    expect(Array.from(packed.to)).toEqual(Array.from(live.to));
    expect(Array.from(packed.from)).toEqual(Array.from(live.from));
    expect(packed.names).toEqual(live.names);
    for (let e = 0; e < live.edgeCount; e++) {
      expect(packed.cost[e]).toBeCloseTo(live.cost[e], 2);
      expect(packed.length[e]).toBeCloseTo(live.length[e], 1);
      expect(packed.name[e]).toBe(live.name[e]);
    }
    expect(packed.vmax).toBeCloseTo(live.vmax, 4);
  });
  it('même itinéraire sur les deux graphes', () => {
    const a = { lat: 48.85, lon: 2.35 }, b = { lat: 48.856, lon: 2.3584 };
    const ra = runToEnd(packed, nearestNode(packed, a)!.node, nearestNode(packed, b, 'in')!.node, 'astar');
    const rb = runToEnd(live, nearestNode(live, a)!.node, nearestNode(live, b, 'in')!.node, 'astar');
    expect(ra.found).toBe(true);
    expect(ra.distance).toBeCloseTo(rb.distance, 0);
    expect(ra.edges).toEqual(rb.edges);
  });
  it('emprise', () => {
    expect(insidePack({ lat: 48.8566, lon: 2.3522 })).toBe(true); // Paris
    expect(insidePack({ lat: 45.76, lon: 4.83 })).toBe(false); // Lyon
  });
});

describe('pack hors ligne : recherche', () => {
  const rows = (JSON.parse(gunzipSync(fx('places.json.gz')).toString()) as { items: PlaceRow[] }).items;
  const idx = new OfflineIndex([
    ...rows,
    ['Rue de Rivoli', 'Paris', 48.8606, 2.3376, 4],
    ['Avenue des Champs-Élysées', 'Paris', 48.8698, 2.3075, 4],
    ['Gare du Nord', 'Gare, Paris', 48.8809, 2.3553, 3],
    ['Rue de la Gare', 'Pontoise', 49.05, 2.1, 4],
    ['Paris', 'Commune', 48.8566, 2.3522, 0],
  ]);
  it('préfixes, accents, mots vides, abréviations', () => {
    expect(idx.search('champs elysees', null)[0].name).toBe('Avenue des Champs-Élysées');
    expect(idx.search('av champs', null)[0].name).toBe('Avenue des Champs-Élysées');
    expect(idx.search('rivo', null)[0].name).toBe('Rue de Rivoli');
    expect(idx.search('12 rue de rivoli', null)[0].name).toBe('Rue de Rivoli');
  });
  it('une gare passe avant une rue du même nom', () => {
    const r = idx.search('gare', null);
    expect(r[0].name).toMatch(/^Gare/);
  });
  it('entrées de la mini-ville (Python)', () => {
    expect(idx.search('villebois', null)[0]).toMatchObject({ name: 'Villebois', context: 'Commune' });
    expect(idx.search('gare villebois', null)[0].context).toBe('Gare, Villebois');
    expect(idx.search('xyzzy', null)).toEqual([]);
  });
});
