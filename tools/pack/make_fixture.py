#!/usr/bin/env python3
"""Génère une mini-ville OSM (XML) + son équivalent Overpass JSON, pour tester que Python et l'app
construisent exactement le même graphe."""
import json, sys
from pathlib import Path
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
n = 7; lat0, lon0, dl, dn = 48.85, 2.35, 0.001, 0.0014
nodes, ways = [], []
nid = lambda r, c: 1 + r * 100 + c
for r in range(n):
    for c in range(n):
        nodes.append((nid(r, c), lat0 + r * dl, lon0 + c * dn, {}))
nodes.append((9001, 48.853, 2.354, {'place': 'town', 'name': 'Villebois'}))
nodes.append((9002, 48.8555, 2.3565, {'railway': 'station', 'name': 'Gare de Villebois'}))
nodes.append((9003, 48.840, 2.340, {'place': 'village', 'name': 'Saint-Ouen-sur-Bois'}))
wid = 1000
for r in range(n):
    tags = {'highway': 'primary' if r == 3 else 'residential', 'name': f'Rue {r}'}
    if r == 1: tags['oneway'] = 'yes'
    if r == 5: tags['maxspeed'] = '30'
    ways.append((wid, [nid(r, c) for c in range(n)], tags)); wid += 1
for c in range(n):
    tags = {'highway': 'residential', 'name': f'Avenue {c}'}
    if c == 2: tags['oneway'] = '-1'
    ways.append((wid, [nid(r, c) for r in range(n)], tags)); wid += 1
ways.append((wid, [nid(0, 0), nid(1, 1)], {'highway': 'footway', 'name': 'Sentier'})); wid += 1
ways.append((wid, [nid(2, 2), nid(3, 3)], {'highway': 'residential', 'access': 'private'})); wid += 1
ways.append((wid, [nid(4, 4), nid(5, 5), nid(6, 6)], {'highway': 'secondary', 'name': 'Boulevard Diagonal', 'junction': 'roundabout'})); wid += 1
esc = lambda s: s.replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;')
with open(out / 'mini.osm', 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6">\n')
    for i, la, lo, t in nodes:
        f.write(f'<node id="{i}" lat="{la:.7f}" lon="{lo:.7f}" version="1">' + ''.join(f'<tag k="{k}" v="{esc(v)}"/>' for k, v in t.items()) + '</node>\n')
    for i, nds, t in ways:
        f.write(f'<way id="{i}" version="1">' + ''.join(f'<nd ref="{x}"/>' for x in nds) + ''.join(f'<tag k="{k}" v="{esc(v)}"/>' for k, v in t.items()) + '</way>\n')
    f.write('</osm>\n')
els = [{'type': 'way', 'id': i, 'nodes': nds, 'tags': t} for i, nds, t in ways]
els += [{'type': 'node', 'id': i, 'lat': round(la, 7), 'lon': round(lo, 7)} for i, la, lo, _ in nodes]
(out / 'mini.overpass.json').write_text(json.dumps({'elements': els}))
