import { describe, expect, it } from 'vitest';
import { overpassQuery, parsePhoton } from '../repo';

describe('Photon', () => {
  it('nom + contexte (rue, code postal, ville)', () => {
    const r = parsePhoton({ features: [
      { geometry: { coordinates: [2.2945, 48.8584] }, properties: { osm_type: 'W', osm_id: 5013364, name: 'Tour Eiffel', street: 'Avenue Gustave Eiffel', housenumber: '5', postcode: '75007', city: 'Paris' } },
      { geometry: { coordinates: [4.83, 45.76] }, properties: { osm_type: 'N', osm_id: 1, street: 'Rue de la République', housenumber: '12', postcode: '69002', city: 'Lyon' } },
      { geometry: { coordinates: [5.37, 43.29] }, properties: { osm_type: 'R', osm_id: 2, name: 'Marseille', state: 'Provence-Alpes-Côte d’Azur', country: 'France' } },
    ] });
    expect(r[0]).toMatchObject({ name: 'Tour Eiffel', context: '5 Avenue Gustave Eiffel, 75007 Paris', lat: 48.8584, lon: 2.2945 });
    expect(r[1]).toMatchObject({ name: '12 Rue de la République', context: '69002 Lyon' });
    expect(r[2]).toMatchObject({ name: 'Marseille', context: 'Provence-Alpes-Côte d’Azur' });
  });
  it('réponse vide', () => expect(parsePhoton({ features: [] })).toEqual([]));
});

describe('Overpass', () => {
  it('trajet court : toutes les rues dans la boîte', () => {
    const q = overpassQuery({ lat: 48.85, lon: 2.35 }, { lat: 48.86, lon: 2.36 });
    expect(q).toContain('[out:json]');
    expect(q).toContain('residential');
    expect(q).toContain('out body;>;out skel qt;');
    expect(q).not.toContain('footway');
  });
  it('trajet long : grands axes + détail autour de A et B', () => {
    const q = overpassQuery({ lat: 48.85, lon: 2.35 }, { lat: 49.1, lon: 2.6 });
    expect(q.match(/way\[/g)!.length).toBe(3);
  });
});
