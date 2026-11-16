// Téléchargement et lecture du pack hors ligne (Android). Sur ordinateur, indisponible.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { PMTiles, Protocol, type Source } from 'pmtiles';
import { addProtocol } from 'maplibre-gl';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { httpGet } from './repo';
import { OfflineIndex, PACK_BASE, PACK_ID, PlaceRow } from './pack';

export interface PackFile { name: string; size: number; sha256: string }
export interface Manifest {
  id: string;
  name: string;
  version: string;
  bbox: [number, number, number, number];
  mapBuild: string;
  files: { graph: PackFile; places: PackFile; tiles: PackFile };
}
export interface PackStatus {
  files: Record<string, number>;
  downloading: boolean;
  received: number;
  total: number;
  current: string;
  freeBytes: number;
  error?: string;
}

interface OfflinePackPlugin {
  status(o: { id: string }): Promise<PackStatus>;
  download(o: { id: string; files: { name: string; url: string; size: number }[] }): Promise<{ state: string }>;
  cancel(): Promise<void>;
  remove(o: { id: string }): Promise<void>;
  read(o: { id: string; name: string; offset: number; length: number }): Promise<{ data: string; size: number }>;
}

export const OfflinePack = registerPlugin<OfflinePackPlugin>('OfflinePack');
export const packSupported = () => Capacitor.getPlatform() === 'android';

const LS_KEY = 'kairo-pack-idf';

/** Manifeste du pack installé (enregistré à la fin du téléchargement). */
export function installedManifest(): Manifest | null {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch {
    return null;
  }
}
export function saveInstalled(m: Manifest | null) {
  try {
    if (m) localStorage.setItem(LS_KEY, JSON.stringify(m));
    else localStorage.removeItem(LS_KEY);
  } catch { /* stockage indisponible */ }
}

export async function fetchManifest(): Promise<Manifest> {
  const r = await httpGet(`${PACK_BASE}/manifest.json`, { timeoutMs: 15000 });
  if (r.status >= 400) throw new Error(r.status === 404 ? 'Le pack n’est pas encore disponible.' : `Erreur ${r.status}`);
  return JSON.parse(r.text);
}

export const packTotal = (m: Manifest) => m.files.graph.size + m.files.places.size + m.files.tiles.size;

/** Vrai si les trois fichiers sont présents avec la bonne taille. */
export function isComplete(m: Manifest | null, st: PackStatus | null): boolean {
  if (!m || !st) return false;
  return Object.values(m.files).every((f) => st.files[f.name] === f.size);
}

export function startDownload(m: Manifest) {
  const files = [m.files.graph, m.files.places, m.files.tiles].map((f) => ({ name: f.name, url: `${PACK_BASE}/${f.name}`, size: f.size }));
  return OfflinePack.download({ id: PACK_ID, files });
}

// ------------------------------------------------------------ Lecture

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function readFile(name: string, size: number, onProgress?: (r: number) => void): Promise<Uint8Array> {
  const CHUNK = 4 * 1024 * 1024;
  const out = new Uint8Array(size);
  for (let off = 0; off < size; off += CHUNK) {
    const r = await OfflinePack.read({ id: PACK_ID, name, offset: off, length: Math.min(CHUNK, size - off) });
    out.set(b64ToBytes(r.data), off);
    onProgress?.(Math.min(1, (off + CHUNK) / size));
  }
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** Graphe routier décompressé, prêt à être transféré au worker. */
export async function loadPackGraph(m: Manifest, onProgress?: (r: number) => void): Promise<ArrayBuffer> {
  return gunzip(await readFile(m.files.graph.name, m.files.graph.size, onProgress));
}

let indexPromise: Promise<OfflineIndex> | null = null;
export function loadPackIndex(m: Manifest): Promise<OfflineIndex> {
  if (!indexPromise) {
    indexPromise = (async () => {
      const json = JSON.parse(new TextDecoder().decode(await gunzip(await readFile(m.files.places.name, m.files.places.size))));
      return new OfflineIndex(json.items as PlaceRow[]);
    })().catch((e) => {
      indexPromise = null;
      throw e;
    });
  }
  return indexPromise;
}
export function resetPackCaches() {
  indexPromise = null;
}

// ------------------------------------------------------------ Carte hors ligne (PMTiles + style sombre)

class NativeSource implements Source {
  constructor(private name: string) {}
  getKey() {
    return 'kairo-idf';
  }
  async getBytes(offset: number, length: number) {
    const r = await OfflinePack.read({ id: PACK_ID, name: this.name, offset, length });
    const bytes = b64ToBytes(r.data);
    return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  }
}

let protocolReady = false;
export function offlineStyle(m: Manifest): any {
  if (!protocolReady) {
    const protocol = new Protocol();
    protocol.add(new PMTiles(new NativeSource(m.files.tiles.name)));
    addProtocol('pmtiles', protocol.tile);
    // Polices : une plage de caractères absente de l'app ne doit pas bloquer l'affichage des noms.
    addProtocol('kglyph', async (params: { url: string }) => {
      try {
        const res = await fetch(params.url.replace('kglyph://', ''));
        if (res.ok) return { data: await res.arrayBuffer() };
      } catch { /* plage absente */ }
      return { data: new ArrayBuffer(0) };
    });
    protocolReady = true;
  }
  const base = new URL('./map-assets/', document.baseURI).href;
  return {
    version: 8,
    glyphs: `kglyph://${base}fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}sprites/v4/dark`,
    sources: {
      protomaps: { type: 'vector', url: 'pmtiles://kairo-idf', attribution: '© OpenStreetMap · Protomaps' },
    },
    layers: layers('protomaps', namedFlavor('dark'), { lang: 'fr' }),
  };
}
