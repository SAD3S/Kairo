import { describe, expect, it, vi } from 'vitest';

vi.mock('../ai/web', () => ({
  webSearch: vi.fn(async (q: string) => [
    { title: 'Résultat A', url: 'https://a.example/x', content: `contenu A pour ${q}` },
    { title: 'Résultat B', url: 'https://b.example/y', content: 'contenu B' },
  ]),
  webFetch: vi.fn(async (url: string) => ({ title: 'Page', url, content: 'texte de la page' })),
  hostOf: (u: string) => new URL(u).hostname,
}));
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => undefined }));

import { addDays, dayKey, startOfWeek } from '../dates';
import { bestStreak, currentStreak, habitGrid, weekDone } from '../habits';
import { Habit } from '../types';
import { buildContext, scoreNote, words } from '../ai/context';
import { cleanReformat, parseTool, runAgent, visiblePart } from '../ai/agent';
import { gemmaPrompt } from '../ai/device';
import { readNdjson, toOllamaMessages } from '../ai/ollama';
import { emptyData, sanitize } from '../store';
import { LlmBackend, LlmMessage } from '../ai/types';

const today = new Date(2026, 10, 16); // lundi 16 nov. 2026
const mk = (days: number[]): Habit => ({
  id: 'h', name: 'Sport', desc: '', color: '#fff', icon: 'sport', target: 4, createdAt: 0,
  log: Object.fromEntries(days.map((d) => [dayKey(addDays(today, d)), true])) as Record<string, true>,
});

describe('dates & habitudes', () => {
  it('semaine commence le lundi', () => {
    expect(dayKey(startOfWeek(new Date(2026, 10, 22)))).toBe('2026-11-16');
    expect(dayKey(startOfWeek(today))).toBe('2026-11-16');
  });
  it('série en cours, y compris si aujourd’hui pas encore fait', () => {
    expect(currentStreak(mk([0, -1, -2]), today)).toBe(3);
    expect(currentStreak(mk([-1, -2]), today)).toBe(2);
    expect(currentStreak(mk([-2, -3]), today)).toBe(0);
  });
  it('record', () => {
    expect(bestStreak(mk([-10, -9, -8, -7, -3, -2]))).toBe(4);
  });
  it('compte de la semaine', () => {
    expect(weekDone(mk([0, -1]), today)).toBe(1); // dimanche -1 = semaine précédente
  });
  it('grille 22 semaines', () => {
    const g = habitGrid(mk([0]), 22, today);
    expect(g).toHaveLength(154);
    const t = g.find((c) => c.today)!;
    expect(t.done).toBe(true);
    expect(g.filter((c) => c.future)).toHaveLength(6);
  });
});

describe('contexte IA', () => {
  it('mots-clés sans accents ni mots vides', () => {
    expect(words('Résumé de mes Accords à bosser')).toEqual(['resume', 'accords', 'bosser']);
  });
  it('choisit les notes pertinentes et respecte le budget', () => {
    const d = emptyData();
    d.habits = [mk([0])];
    d.notes = [
      { id: '1', title: 'Accords guitare', body: 'Do Ré Mi, accords barrés', tags: [], pinned: false, createdAt: 0, updatedAt: 0 },
      { id: '2', title: 'Courses', body: 'lait pain', tags: [], pinned: false, createdAt: 0, updatedAt: 0 },
    ];
    expect(scoreNote(d.notes[0], words('mes accords'))).toBeGreaterThan(0);
    const c = buildContext(d, 'quels accords je travaille ?', 3000);
    expect(c.text).toContain('### Accords guitare');
    expect(c.text).not.toContain('lait pain');
    expect(c.text).toContain('- Courses');
    expect(c.text).toContain('HABITUDES');
    expect(c.text.length).toBeLessThan(3200);
  });
});

describe('outils & formats', () => {
  it('détecte les commandes web', () => {
    expect(parseTool('[[search: météo Lyon demain]]')).toEqual({ kind: 'search', arg: 'météo Lyon demain' });
    expect(parseTool('Je regarde. [[fetch: https://x.fr/a]]')).toEqual({ kind: 'fetch', arg: 'https://x.fr/a' });
    expect(parseTool('Bonjour')).toBeNull();
  });
  it('cache les commandes pendant le streaming', () => {
    expect(visiblePart('[')).toBe('');
    expect(visiblePart('[[sea')).toBe('');
    expect(visiblePart('Ok [[search: x]]')).toBe('Ok');
    expect(visiblePart('Bonjour')).toBe('Bonjour');
  });
  it('nettoie la remise en forme', () => {
    expect(cleanReformat('```markdown\n## A\n- b\n```')).toBe('## A\n- b');
  });
  it('prompt Gemma avec image sur le dernier tour', () => {
    const p = gemmaPrompt([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'yo' },
      { role: 'user', content: 'et ça ?', image: 'data:image/jpeg;base64,AAA' },
    ], true) as any[];
    expect(p[0]).toBe('<start_of_turn>user\n');
    expect(p[1]).toBe('SYS\n\nsalut<end_of_turn>\n');
    expect(p).toContainEqual({ imageSource: 'data:image/jpeg;base64,AAA' });
    expect(p[p.length - 1]).toBe('<start_of_turn>model\n');
  });
  it('messages Ollama : image en base64 sans préfixe', () => {
    expect(toOllamaMessages([{ role: 'user', content: 'x', image: 'data:image/jpeg;base64,QUJD' }])[0]).toEqual({ role: 'user', content: 'x', images: ['QUJD'] });
  });
  it('lit un flux NDJSON découpé', async () => {
    const enc = new TextEncoder();
    const chunks = ['{"message":{"content":"Bon"}}\n{"mess', 'age":{"content":"jour"}}\n', '{"done":true}'];
    const stream = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });
    const got: any[] = [];
    await readNdjson(stream, (o) => got.push(o));
    expect(got.map((o) => o.message?.content ?? 'END')).toEqual(['Bon', 'jour', 'END']);
  });
  it('sanitize remplit les champs manquants', () => {
    const d = sanitize({ habits: [{ id: 'a', name: 'X' }], settings: { ollamaModel: 'm' } });
    expect(d.habits[0].log).toEqual({});
    expect(d.settings.ollamaModel).toBe('m');
    expect(d.settings.ollamaUrl).toBeTruthy();
  });
});

describe('boucle de l’agent', () => {
  function fake(replies: string[]): LlmBackend & { calls: LlmMessage[][] } {
    const calls: LlmMessage[][] = [];
    return {
      label: 'FAKE', contextBudget: 4000, calls,
      async chat(messages, opts) {
        calls.push(messages.map((m) => ({ ...m })));
        const r = replies.shift() ?? '';
        for (const part of r.match(/.{1,5}/gs) ?? []) opts.onDelta(part, 'content');
        return r;
      },
    };
  }

  it('cherche sur le web puis répond, avec statuts et sources', async () => {
    const d = emptyData();
    d.settings.webEnabled = true;
    d.settings.ollamaApiKey = 'k';
    const be = fake(['[[search: prix essence]]', 'Le prix est 1,80 € [1].']);
    const statuses: string[] = [];
    const texts: string[] = [];
    const r = await runAgent({ data: d, history: [], text: 'prix essence ?', backend: be, onStatus: (s) => statuses.push(s), onText: (t) => texts.push(t) });
    expect(r.text).toBe('Le prix est 1,80 € [1].');
    expect(r.sources.map((s) => s.url)).toEqual(['https://a.example/x', 'https://b.example/y']);
    expect(statuses).toEqual(['data', 'think', 'web', 'web', 'think', 'write']);
    expect(texts.some((t) => t.includes('[['))).toBe(false);
    expect(be.calls[1].at(-1)!.content).toContain('contenu A pour prix essence');
  });

  it('image → statut vision, image envoyée une seule fois', async () => {
    const d = emptyData();
    const be = fake(['Un condensateur.']);
    const statuses: string[] = [];
    await runAgent({ data: d, history: [], text: 'quoi ?', image: 'data:image/jpeg;base64,AA', backend: be, onStatus: (s) => statuses.push(s), onText: () => {} });
    expect(statuses[1]).toBe('vision');
    expect(be.calls[0].at(-1)!.image).toBeTruthy();
  });

  it('web désactivé : pas de requête, réponse quand même', async () => {
    const d = emptyData();
    d.settings.webEnabled = false;
    const be = fake(['[[search: x]]', 'Je ne peux pas vérifier.']);
    const r = await runAgent({ data: d, history: [], text: 'x', backend: be, onStatus: () => {}, onText: () => {} });
    expect(r.text).toBe('Je ne peux pas vérifier.');
    expect(be.calls[0][0].content).not.toContain('[[search');
  });
});

import { splitForNative } from '../ai/native';
describe('plugin Android', () => {
  it('découpe system / historique / dernier message + image base64', () => {
    const r = splitForNative([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c', image: 'data:image/jpeg;base64,XYZ' },
    ]);
    expect(r).toEqual({ system: 'S', history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }], text: 'c', image: 'XYZ' });
  });
});

import { createFolder, deleteFolder, getState, setState, upsertNote } from '../store';
describe('dossiers', () => {
  it('pas de doublon (casse/accents), suppression garde les notes', () => {
    setState(() => emptyData());
    const a = createFolder('Films');
    expect(createFolder('  films ')).toBe(a);
    const b = createFolder('Séries');
    expect(createFolder('series')).toBe(b);
    expect(getState().folders.map((f) => f.name)).toEqual(['Films', 'Séries']);
    upsertNote({ id: 'x', title: 'Dune', body: '', tags: [], pinned: false, folderId: a, createdAt: 0, updatedAt: 0 });
    deleteFolder(a);
    expect(getState().folders).toHaveLength(1);
    expect(getState().notes.find((n) => n.id === 'x')!.folderId).toBeUndefined();
  });
  it('sanitize : anciennes sauvegardes sans dossiers', () => {
    expect(sanitize({ notes: [] }).folders).toEqual([]);
  });
});

describe('conversation depuis une note', () => {
  const data = () => {
    const d = emptyData();
    d.folders = [{ id: 'f', name: 'Films', createdAt: 0 }];
    d.notes = [
      { id: 'a', title: 'Dune 2', body: 'Revoir en IMAX. Villeneuve.', tags: [], pinned: false, folderId: 'f', createdAt: 0, updatedAt: 0 },
      { id: 'b', title: 'Liste de courses', body: 'lait, pain', tags: [], pinned: false, createdAt: 0, updatedAt: 0 },
      { id: 'c', title: 'Villeneuve filmographie', body: 'Arrival, Sicario, Blade Runner 2049', tags: [], pinned: false, createdAt: 0, updatedAt: 0 },
    ];
    d.habits = [mk([0])];
    return d;
  };
  it('la note ouverte passe en premier, avant les habitudes', () => {
    const c = buildContext(data(), 'résume', 3500, 'a');
    expect(c.focusTitle).toBe('Dune 2');
    const i = c.text.indexOf('NOTE OUVERTE');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(c.text.indexOf('HABITUDES'));
    expect(c.text).toContain('dossier : Films');
    expect(c.text).toContain('Villeneuve filmographie'); // note liée trouvée via le titre de la note ouverte
    expect(c.used[0]).toBe('NOTE OUVERTE');
  });
  it('l’IA peut lire une autre note avec [[note: …]]', async () => {
    const replies = ['[[note: courses]]', 'Il te faut du lait et du pain.'];
    const calls: any[] = [];
    const be: LlmBackend = { label: 'F', contextBudget: 3500, async chat(m, o) { calls.push(m); const r = replies.shift()!; o.onDelta(r, 'content'); return r; } };
    const statuses: string[] = [];
    const r = await runAgent({ data: data(), history: [], text: 'et pour les courses ?', focusNoteId: 'a', backend: be, onStatus: (s, sub) => statuses.push(`${s}:${sub ?? ''}`), onText: () => {} });
    expect(r.text).toBe('Il te faut du lait et du pain.');
    expect(calls[0][0].content).toContain('CONTEXTE PRINCIPAL');
    expect(calls[1].at(-1).content).toContain('lait, pain');
    expect(statuses).toContain('data:lit « Liste de courses »');
    expect(r.used).toContain('+NOTE LUE');
  });
});
