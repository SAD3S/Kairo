import { AppData, ChatMsg, Source } from '../types';
import { buildContext, REFORMAT_PROMPT, systemPrompt } from './context';
import { deviceBackend } from './device';
import { ollamaBackend } from './ollama';
import { AiStatus, LlmBackend, LlmMessage } from './types';
import { hostOf, webFetch, webSearch } from './web';

export type StatusFn = (s: AiStatus, sub?: string) => void;

export function backendFor(data: AppData): LlmBackend {
  return data.settings.backend === 'device' ? deviceBackend() : ollamaBackend(data.settings);
}

const TOOL_RE = /\[\[\s*(search|fetch)\s*:\s*([^\]]+?)\s*\]\]/i;

export function parseTool(text: string): { kind: 'search' | 'fetch'; arg: string } | null {
  const m = text.match(TOOL_RE);
  return m ? { kind: m[1].toLowerCase() as 'search' | 'fetch', arg: m[2].trim() } : null;
}

/** Texte affichable pendant le streaming : on cache les commandes [[...]]. */
export function visiblePart(text: string): string {
  const i = text.indexOf('[[');
  if (i >= 0) return text.slice(0, i).trimEnd();
  if (/^\s*\[?$/.test(text)) return '';
  return text;
}

export interface RunOptions {
  data: AppData;
  history: ChatMsg[];
  text: string;
  image?: string;
  focusNoteId?: string;
  signal?: AbortSignal;
  onStatus: StatusFn;
  onText: (t: string) => void;
  backend?: LlmBackend;
}

export interface RunResult {
  text: string;
  sources: Source[];
  used: string[];
}

export async function runAgent(o: RunOptions): Promise<RunResult> {
  const backend = o.backend ?? backendFor(o.data);
  const s = o.data.settings;
  const web = s.webEnabled;

  o.onStatus('data', `${o.data.habits.length} habitudes · ${o.data.notes.length} notes`);
  const ctx = buildContext(o.data, o.text, backend.contextBudget, o.focusNoteId);

  const messages: LlmMessage[] = [{ role: 'system', content: systemPrompt(ctx.text, web) }];
  for (const m of o.history.filter((m) => !m.error && m.text).slice(-8)) {
    messages.push({ role: m.role, content: m.text });
  }
  messages.push({ role: 'user', content: o.text || 'Que vois-tu ?', image: o.image });

  const sources: Source[] = [];
  const waiting: [AiStatus, string] = o.image ? ['vision', 'analyse de l’image'] : ['think', 'prépare la réponse'];

  for (let step = 0; step < 4; step++) {
    o.onStatus(...waiting);
    let out = '';
    let writing = false;
    await backend.chat(messages, {
      signal: o.signal,
      onPrep: (sub) => o.onStatus('think', sub),
      onDelta: (d, kind) => {
        if (kind === 'thinking') {
          if (!writing) o.onStatus(waiting[0], o.image ? 'analyse de l’image' : 'raisonne');
          return;
        }
        out += d;
        const vis = visiblePart(out);
        if (vis.trim()) {
          if (!writing) {
            writing = true;
            o.onStatus('write', 'réponse en cours');
          }
          o.onText(vis);
        }
      },
    });

    const tool = parseTool(out);
    if (!tool || step === 3) {
      const final = out.replace(TOOL_RE, '').trim();
      return { text: final, sources, used: ctx.used };
    }

    messages.push({ role: 'assistant', content: out.trim() });
    // L'image n'est envoyée qu'une fois.
    messages.forEach((m) => delete m.image);

    if (!web) {
      messages.push({ role: 'user', content: "La recherche web est désactivée. Réponds avec ce que tu sais, en précisant que tu n'as pas pu vérifier en ligne." });
      continue;
    }
    try {
      if (tool.kind === 'search') {
        o.onStatus('web', `« ${tool.arg.slice(0, 40)} »`);
        const results = await webSearch(tool.arg, s.ollamaApiKey);
        const offset = sources.length;
        sources.push(...results.map(({ title, url }) => ({ title, url })));
        o.onStatus('web', `${results.length} pages lues`);
        const body = results.map((r, i) => `[${offset + i + 1}] ${r.title} — ${r.url}\n${r.content.slice(0, 1200)}`).join('\n\n');
        messages.push({ role: 'user', content: `Résultats de recherche pour « ${tool.arg} » :\n\n${body || 'Aucun résultat.'}\n\nRéponds maintenant à ma question en t'appuyant sur ces résultats. Cite les sources avec leur numéro.` });
      } else {
        o.onStatus('web', `lit ${hostOf(tool.arg)}`);
        const page = await webFetch(tool.arg, s.ollamaApiKey);
        sources.push({ title: page.title, url: page.url });
        messages.push({ role: 'user', content: `Contenu de la page [${sources.length}] ${page.title} (${page.url}) :\n\n${page.content.slice(0, 4000)}\n\nRéponds maintenant à ma question.` });
      }
    } catch (e: any) {
      messages.push({ role: 'user', content: `La recherche web a échoué (${e?.message || 'erreur'}). Réponds avec ce que tu sais, en le précisant.` });
    }
  }
  return { text: '', sources, used: ctx.used };
}

export function cleanReformat(text: string): string {
  return text
    .replace(/^\s*```(?:markdown|md)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

export async function reformatNote(
  data: AppData,
  title: string,
  body: string,
  o: { signal?: AbortSignal; onStatus: StatusFn; onText: (t: string) => void },
): Promise<string> {
  const backend = backendFor(data);
  o.onStatus('format', 'titres · listes · fautes');
  let out = '';
  await backend.chat(
    [
      { role: 'system', content: REFORMAT_PROMPT },
      { role: 'user', content: `Titre de la note : ${title || 'Sans titre'}\n\nNote à remettre en forme :\n\n${body}` },
    ],
    {
      signal: o.signal,
      onPrep: (sub) => o.onStatus('think', sub),
      onDelta: (d, kind) => {
        if (kind !== 'content') return;
        if (!out) o.onStatus('format', 'réécrit la note');
        out += d;
        o.onText(cleanReformat(out));
      },
    },
  );
  return cleanReformat(out);
}
