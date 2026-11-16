#!/usr/bin/env python3
"""
Construit le pack hors ligne d'une région à partir d'un extrait OpenStreetMap (.osm.pbf ou .osm) :
  - <out>/graph.bin.gz  : graphe routier voiture (format binaire lu par l'app, voir src/features/route/pack.ts)
  - <out>/places.json.gz : index de recherche (communes, lieux connus, rues)

Les règles (voies carrossables, vitesses, sens uniques) sont les mêmes que src/features/route/graph.ts.
Usage : python3 build_pack.py ile-de-france-latest.osm.pbf out/
"""
import gzip
import json
import math
import re
import struct
import sys
import unicodedata
from pathlib import Path

import numpy as np
import osmium
from scipy.spatial import cKDTree

CAR_HIGHWAYS = {
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road',
}
SPEED_KMH = {
    'motorway': 120, 'motorway_link': 60, 'trunk': 100, 'trunk_link': 50, 'primary': 75, 'primary_link': 45,
    'secondary': 65, 'secondary_link': 40, 'tertiary': 50, 'tertiary_link': 35, 'unclassified': 45,
    'residential': 30, 'living_street': 15, 'service': 15, 'road': 40,
}
EXCLUDED_ACCESS = re.compile(r'^(no|private|delivery|agricultural|forestry|destination_only)$')
NAMED_SPEEDS = {'fr:urban': 50, 'fr:rural': 80, 'fr:motorway': 130, 'fr:zone30': 30, 'walk': 6, 'living_street': 20}
STREET_HIGHWAYS = CAR_HIGHWAYS | {'pedestrian', 'track'}

POI_KINDS = [
    ('railway', {'station': 'Gare', 'halt': 'Gare'}),
    ('aeroway', {'aerodrome': 'Aéroport', 'terminal': 'Terminal'}),
    ('amenity', {'hospital': 'Hôpital', 'university': 'Université', 'college': 'École', 'townhall': 'Mairie',
                 'library': 'Bibliothèque', 'cinema': 'Cinéma', 'theatre': 'Théâtre', 'stadium': 'Stade',
                 'police': 'Police', 'post_office': 'Poste', 'marketplace': 'Marché'}),
    ('tourism', {'museum': 'Musée', 'attraction': 'Lieu touristique', 'zoo': 'Zoo', 'theme_park': 'Parc d’attractions'}),
    ('leisure', {'park': 'Parc', 'stadium': 'Stade', 'sports_centre': 'Centre sportif'}),
    ('shop', {'mall': 'Centre commercial', 'department_store': 'Grand magasin'}),
    ('historic', {'monument': 'Monument', 'castle': 'Château'}),
]
PLACE_RANK = {'city': 0, 'town': 1, 'suburb': 2, 'village': 2, 'hamlet': 3}


def parse_maxspeed(v):
    if not v:
        return None
    s = v.strip().lower()
    if s in NAMED_SPEEDS:
        return NAMED_SPEEDS[s]
    m = re.match(r'^(\d+(?:\.\d+)?)\s*(mph|km/h|kmh)?', s)
    if not m:
        return None
    n = float(m.group(1))
    return n * 1.609 if m.group(2) == 'mph' else n


def speed_for(tags):
    base = SPEED_KMH.get(tags.get('highway'), 40)
    mx = parse_maxspeed(tags.get('maxspeed'))
    return min(mx * 0.9, base * 1.5) if mx else base


def oneway_of(tags):
    o = (tags.get('oneway') or '').lower()
    if o in ('-1', 'reverse'):
        return -1
    if o in ('yes', 'true', '1'):
        return 1
    if o in ('no', 'false', '0'):
        return 0
    if tags.get('junction') in ('roundabout', 'circular'):
        return 1
    if tags.get('highway') in ('motorway', 'motorway_link'):
        return 1
    return 0


def is_drivable(tags):
    if tags.get('highway') not in CAR_HIGHWAYS:
        return False
    if tags.get('area') == 'yes':
        return False
    for k in ('access', 'motor_vehicle', 'motorcar'):
        if EXCLUDED_ACCESS.match(tags.get(k) or ''):
            return False
    if tags.get('service') in ('parking_aisle', 'driveway'):
        return False
    return True


def haversine(lat1, lon1, lat2, lon2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl, dn = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dl / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dn / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []  # (tags dict, [(id, lat, lon)])
        self.streets = []  # (name, lat, lon)
        self.places = []  # (name, kind, lat, lon)
        self.pois = []  # (name, label, lat, lon)

    def _poi(self, tags):
        name = tags.get('name')
        if not name:
            return None
        for key, kinds in POI_KINDS:
            v = tags.get(key)
            if v in kinds:
                return kinds[v]
        return None

    def node(self, n):
        t = n.tags
        if not len(t):
            return
        if t.get('place') in PLACE_RANK and t.get('name'):
            self.places.append((t['name'], t['place'], n.location.lat, n.location.lon))
        label = self._poi(t)
        if label:
            self.pois.append((t['name'], label, n.location.lat, n.location.lon))

    def way(self, w):
        t = w.tags
        hw = t.get('highway')
        try:
            pts = [(nd.ref, nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        except osmium.InvalidLocationError:
            return
        if len(pts) < 2:
            return
        if hw in STREET_HIGHWAYS and t.get('name'):
            mid = pts[len(pts) // 2]
            self.streets.append((t['name'], mid[1], mid[2]))
        if is_drivable(t):
            keep = {k: t.get(k) for k in ('highway', 'name', 'ref', 'maxspeed', 'oneway', 'junction') if t.get(k)}
            self.ways.append((keep, pts))
        else:
            label = self._poi(t)
            if label:
                mid = pts[len(pts) // 2]
                self.pois.append((t['name'], label, mid[1], mid[2]))


def build_graph(ways):
    use = {}
    for _, pts in ways:
        for nid, _, _ in pts:
            use[nid] = use.get(nid, 0) + 1
    index, lat, lon = {}, [], []

    def node_of(nid, la, lo):
        i = index.get(nid)
        if i is None:
            i = len(lat)
            index[nid] = i
            lat.append(la)
            lon.append(lo)
        return i

    names, name_idx = [], {}
    edges = []  # (a, b, cost, len, name, pts list of (lon,lat))
    vmax = 1.0
    for tags, pts in ways:
        ms = speed_for(tags) / 3.6
        vmax = max(vmax, ms)
        d = oneway_of(tags)
        label = tags.get('name') or tags.get('ref') or ''
        ni = -1
        if label:
            ni = name_idx.get(label, -1)
            if ni < 0:
                ni = len(names)
                names.append(label)
                name_idx[label] = ni
        start = 0
        for k in range(1, len(pts)):
            if not (k == len(pts) - 1 or use.get(pts[k][0], 0) > 1):
                continue
            seg = pts[start:k + 1]
            length = sum(haversine(seg[j - 1][1], seg[j - 1][2], seg[j][1], seg[j][2]) for j in range(1, len(seg)))
            a = node_of(*seg[0])
            b = node_of(*seg[-1])
            if a != b:
                geo = [(p[2], p[1]) for p in seg]
                cost = length / ms
                if d >= 0:
                    edges.append((a, b, cost, length, ni, geo))
                if d <= 0:
                    edges.append((b, a, cost, length, ni, geo[::-1]))
            start = k

    n, m = len(lat), len(edges)
    edges.sort(key=lambda e: e[0])  # tri stable : même ordre que l'app
    first = np.zeros(n + 1, dtype=np.int32)
    for e in edges:
        first[e[0] + 1] += 1
    first = np.cumsum(first, dtype=np.int64).astype(np.int32)
    to = np.array([e[1] for e in edges], dtype=np.int32)
    cost = np.array([e[2] for e in edges], dtype=np.float32)
    length = np.array([e[3] for e in edges], dtype=np.float32)
    name = np.array([e[4] for e in edges], dtype=np.int32)
    counts = np.array([len(e[5]) for e in edges], dtype=np.int64)
    geo_start = np.zeros(m + 1, dtype=np.int64)
    geo_start[1:] = np.cumsum(counts)
    geo = np.array([c for e in edges for p in e[5] for c in p], dtype=np.float32)
    return {
        'lat': np.array(lat, dtype=np.float32), 'lon': np.array(lon, dtype=np.float32), 'first': first, 'to': to,
        'cost': cost, 'length': length, 'name': name, 'geo_start': geo_start.astype(np.int32), 'geo': geo,
        'names': names, 'vmax': vmax,
    }


def write_graph(g, path):
    names = '\n'.join(g['names']).encode('utf-8')
    n, m, p = len(g['lat']), len(g['to']), len(g['geo']) // 2
    lat, lon = g['lat'], g['lon']
    bbox = (float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())) if n else (0, 0, 0, 0)
    header = b'KGR1' + struct.pack('<5I5f', 1, n, m, p, len(names), g['vmax'], *bbox)
    with gzip.open(path, 'wb', compresslevel=9) as f:
        f.write(header)
        for key in ('lat', 'lon', 'first', 'to', 'cost', 'length', 'name', 'geo_start', 'geo'):
            f.write(g[key].astype('<f4' if g[key].dtype == np.float32 else '<i4').tobytes())
        f.write(names)
    return n, m, p


def build_places(c):
    towns = [(nm, k, la, lo) for nm, k, la, lo in c.places if k in ('city', 'town', 'village')]
    items = []
    for nm, k, la, lo in c.places:
        items.append([nm, 'Commune' if k in ('city', 'town', 'village') else 'Quartier', round(la, 5), round(lo, 5), PLACE_RANK[k]])
    if towns:
        coslat = math.cos(math.radians(sum(t[2] for t in towns) / len(towns)))
        tree = cKDTree(np.array([(t[2], t[3] * coslat) for t in towns]))

        def commune(la, lo):
            return towns[int(tree.query((la, lo * coslat))[1])][0]
    else:
        def commune(la, lo):
            return ''
    seen = set()
    for nm, label, la, lo in c.pois:
        key = (norm(nm), label)
        if key in seen:
            continue
        seen.add(key)
        items.append([nm, f'{label}, {commune(la, lo)}'.strip(', '), round(la, 5), round(lo, 5), 3])
    seen = set()
    for nm, la, lo in c.streets:
        town = commune(la, lo)
        key = (norm(nm), town)
        if key in seen:
            continue
        seen.add(key)
        items.append([nm, town, round(la, 5), round(lo, 5), 4])
    return items


def main():
    src, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    c = Collector()
    c.apply_file(src, locations=True, idx='flex_mem')
    print(f'voies carrossables : {len(c.ways)}, rues nommées : {len(c.streets)}, lieux : {len(c.places)}, POI : {len(c.pois)}')
    g = build_graph(c.ways)
    n, m, p = write_graph(g, out / 'graph.bin.gz')
    print(f'graphe : {n} nœuds, {m} arêtes, {p} points de géométrie')
    items = build_places(c)
    with gzip.open(out / 'places.json.gz', 'wt', encoding='utf-8', compresslevel=9) as f:
        json.dump({'v': 1, 'items': items}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'index : {len(items)} entrées')


if __name__ == '__main__':
    main()
