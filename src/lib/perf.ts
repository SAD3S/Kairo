// Mesures de performance prises sur l'appareil, visibles dans Réglages → Performances.
const KEY = 'kairo-perf';

export interface PerfEntry { ms: number; at: number; note?: string }
export const PERF_LABELS: Record<string, string> = {
  'app.start': 'Démarrage : premier écran affiché',
  'map.ready': 'Carte utilisable',
  'graph.download': 'Routes : téléchargement (Overpass)',
  'graph.build': 'Routes : construction du graphe',
  'graph.pack': 'Routes : chargement du pack hors ligne',
  'route.compute': 'Itinéraire : calcul (sans l’animation)',
  'ai.firstToken': 'IA : premier mot affiché',
  'ai.total': 'IA : réponse complète',
};

export function readPerf(): Record<string, PerfEntry> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function perfMark(name: string, ms: number, note?: string) {
  try {
    const all = readPerf();
    all[name] = { ms: Math.round(ms), at: Date.now(), note };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* stockage indisponible */ }
}
export function clearPerf() {
  try { localStorage.removeItem(KEY); } catch { /* rien */ }
}
export function perfReport(version: string): string {
  const all = readPerf();
  const lines = Object.keys(PERF_LABELS).filter((k) => all[k]).map((k) => `- ${PERF_LABELS[k]} : ${all[k].ms} ms${all[k].note ? ` (${all[k].note})` : ''}`);
  return `Kairo ${version}\n${lines.join('\n') || '(aucune mesure)'}`;
}
