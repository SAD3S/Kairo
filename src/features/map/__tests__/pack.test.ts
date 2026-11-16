import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { insidePack, OfflineIndex, PlaceRow } from '../pack';

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));

describe('pack hors ligne : emprise', () => {
  it('Paris dedans, Lyon dehors', () => {
    expect(insidePack({ lat: 48.8566, lon: 2.3522 })).toBe(true);
    expect(insidePack({ lat: 45.76, lon: 4.83 })).toBe(false);
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
