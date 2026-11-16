import { habitSummary } from '../habits';
import { longDate, relativeLabel } from '../dates';
import { AppData, Note } from '../types';

const STOP = new Set(
  'les des une un le la de du et en au aux pour par sur dans avec que qui quoi est sont mon ma mes ton ta tes son sa ses ce cet cette ces pas plus moi toi lui nous vous ils elles je tu il elle on fait faire comment quel quelle quels quelles the and for with what this that'.split(' '),
);

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function scoreNote(n: Note, query: string[]): number {
  if (!query.length) return 0;
  const t = new Set(words(n.title + ' ' + n.tags.join(' ')));
  const b = words(n.body);
  let s = 0;
  for (const q of query) {
    if (t.has(q)) s += 3;
    for (const w of b) if (w === q || (q.length > 4 && w.startsWith(q.slice(0, -1)))) s += 1;
  }
  return s;
}

export interface BuiltContext {
  text: string;
  used: string[];
}

/** Construit le contexte (habitudes + notes pertinentes) donné à l'IA. */
export function buildContext(data: AppData, userText: string, budget: number, focusNoteId?: string): BuiltContext {
  const now = new Date();
  const used: string[] = [];
  const lines: string[] = [`Date du jour : ${longDate(now)}.`];

  if (data.habits.length) {
    lines.push('', 'HABITUDES DE L’UTILISATEUR :', ...data.habits.map((h) => habitSummary(h, now)));
    used.push(`${data.habits.length} HABITUDE${data.habits.length > 1 ? 'S' : ''}`);
  } else {
    lines.push('', 'L’utilisateur n’a pas encore créé d’habitude.');
  }

  let remaining = budget - lines.join('\n').length;
  const q = words(userText);
  const focus = focusNoteId ? data.notes.find((n) => n.id === focusNoteId) : undefined;
  const ranked = data.notes
    .filter((n) => n.id !== focus?.id)
    .map((n) => ({ n, s: scoreNote(n, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.n);
  const full = [...(focus ? [focus] : []), ...ranked];

  const included: Note[] = [];
  if (full.length) {
    lines.push('', 'NOTES PERTINENTES :');
    for (const n of full) {
      if (remaining < 200) break;
      const max = Math.min(n === focus ? 4000 : 1500, remaining - 100);
      const body = n.body.length > max ? n.body.slice(0, max) + '…' : n.body;
      const block = `### ${n.title || 'Sans titre'}${n === focus ? ' (note ouverte)' : ''} — ${relativeLabel(n.updatedAt)}${n.tags.length ? ' — tags : ' + n.tags.join(', ') : ''}\n${body}`;
      lines.push(block);
      remaining -= block.length;
      included.push(n);
    }
  }

  const others = data.notes.filter((n) => !included.includes(n)).slice(0, 40);
  if (others.length && remaining > 300) {
    const list = others.map((n) => `- ${n.title || 'Sans titre'}`).join('\n');
    lines.push('', 'AUTRES NOTES (titres seulement) :', list.slice(0, Math.max(0, remaining - 50)));
  }
  if (data.notes.length) used.push(`${included.length || data.notes.length} NOTE${(included.length || data.notes.length) > 1 ? 'S' : ''}`);

  return { text: lines.join('\n'), used };
}

export function systemPrompt(context: string, web: boolean): string {
  const tools = web
    ? `\n\nACCÈS INTERNET : si tu as besoin d'une information récente, d'un fait que tu ne connais pas avec certitude, ou si l'utilisateur te demande de chercher, réponds UNIQUEMENT avec une seule ligne :\n[[search: ta requête]]\nPour lire une page précise : [[fetch: https://adresse]]\nTu recevras le résultat, puis tu répondras normalement en citant les sources [1], [2]. N'utilise pas ces commandes pour des questions sur les notes ou les habitudes.`
    : '';
  return `Tu es Kairo, l'assistant personnel intégré à l'application de l'utilisateur (habitudes + notes). Tu tournes en local. Réponds en français, de façon claire, chaleureuse et concise (Markdown léger autorisé : listes, gras). Quand l'utilisateur parle de ses habitudes ou de ses notes, appuie-toi sur les données ci-dessous et n'invente rien. Si une image est jointe, décris et explique précisément ce que tu vois.${tools}\n\n--- DONNÉES DE L'APP ---\n${context}`;
}

export const REFORMAT_PROMPT = `Tu remets en forme des notes personnelles. Règles :
- Garde la langue, le sens et toutes les informations. N'ajoute aucune information.
- Corrige l'orthographe, la grammaire et la ponctuation.
- Structure en Markdown : sections avec "## Titre", listes à puces "- ", listes numérotées si c'est une suite d'étapes, **gras** pour l'essentiel.
- N'écris pas de titre principal "#" : le titre de la note est déjà affiché.
- Réponds UNIQUEMENT avec la note remise en forme, sans phrase d'introduction ni bloc de code.`;

export const CAMERA_PROMPTS: Record<string, string> = {
  explain: "Explique ce que tu vois sur cette image, simplement et précisément. Si c'est un objet ou un appareil, dis ce que c'est, à quoi ça sert et comment on l'utilise.",
  read: "Recopie fidèlement le texte visible sur l'image, puis résume-le en une phrase.",
  translate: "Traduis en français le texte visible sur l'image. Donne d'abord la traduction, puis la langue d'origine.",
};
