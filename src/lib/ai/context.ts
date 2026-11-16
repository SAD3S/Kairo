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

/** `extra` : texte en plus à considérer comme titre (ex. nom du dossier). */
export function scoreNote(n: Note, query: string[], extra = ''): number {
  if (!query.length) return 0;
  const t = new Set(words(n.title + ' ' + n.tags.join(' ') + ' ' + extra));
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
  /** Titre de la note ouverte, si la conversation part d'une note. */
  focusTitle?: string;
}

function noteHeader(data: AppData, n: Note): string {
  const folder = data.folders.find((f) => f.id === n.folderId)?.name;
  return `### ${n.title || 'Sans titre'} — ${relativeLabel(n.updatedAt)}${folder ? ' — dossier : ' + folder : ''}${n.tags.length ? ' — tags : ' + n.tags.join(', ') : ''}`;
}

/** Construit le contexte donné à l'IA.
 *  Avec une note ouverte : elle passe en premier et reçoit l'essentiel du budget ;
 *  les habitudes et les autres notes ne viennent qu'en complément. */
export function buildContext(data: AppData, userText: string, budget: number, focusNoteId?: string): BuiltContext {
  const now = new Date();
  const used: string[] = [];
  const lines: string[] = [`Date du jour : ${longDate(now)}.`];
  const focus = focusNoteId ? data.notes.find((n) => n.id === focusNoteId) : undefined;

  if (focus) {
    const max = Math.max(800, Math.floor(budget * 0.6));
    const body = focus.body.length > max ? focus.body.slice(0, max) + '…' : focus.body;
    lines.push('', 'NOTE OUVERTE — SUJET PRINCIPAL DE LA CONVERSATION :', noteHeader(data, focus), body || '(note vide)');
    used.push('NOTE OUVERTE');
  }

  if (data.habits.length) {
    const hs = data.habits.map((h) => habitSummary(h, now));
    // En mode note, les habitudes ne sont qu'un complément : version courte si le budget est serré.
    const block = focus && budget < 5000 ? hs.map((l) => l.replace(/ · 14 derniers jours.*$/, '')) : hs;
    lines.push('', focus ? 'HABITUDES (complément) :' : 'HABITUDES DE L’UTILISATEUR :', ...block);
    used.push(`${data.habits.length} HABITUDE${data.habits.length > 1 ? 'S' : ''}`);
  } else if (!focus) {
    lines.push('', 'L’utilisateur n’a pas encore créé d’habitude.');
  }

  let remaining = budget - lines.join('\n').length;
  const q = words(userText + (focus ? ' ' + focus.title : ''));
  const ranked = data.notes
    .filter((n) => n.id !== focus?.id)
    .map((n) => ({ n, s: scoreNote(n, q, data.folders.find((f) => f.id === n.folderId)?.name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, focus ? 3 : 5)
    .map((x) => x.n);

  const included: Note[] = focus ? [focus] : [];
  if (ranked.length && remaining > 300) {
    lines.push('', focus ? 'AUTRES NOTES POUVANT AIDER :' : 'NOTES PERTINENTES :');
    for (const n of ranked) {
      if (remaining < 300) break;
      const max = Math.min(focus ? 800 : 1500, remaining - 150);
      const body = n.body.length > max ? n.body.slice(0, max) + '…' : n.body;
      const block = `${noteHeader(data, n)}\n${body}`;
      lines.push(block);
      remaining -= block.length;
      included.push(n);
    }
  }

  const others = data.notes.filter((n) => !included.includes(n)).slice(0, 40);
  if (others.length && remaining > 200) {
    const fname = (id?: string) => data.folders.find((f) => f.id === id)?.name;
    const list = others.map((n) => `- ${n.title || 'Sans titre'}${fname(n.folderId) ? ` [${fname(n.folderId)}]` : ''}`).join('\n');
    lines.push('', 'AUTRES NOTES (titres seulement, lisibles avec [[note: titre]]) :', list.slice(0, Math.max(0, remaining - 50)));
  }
  const nNotes = included.length - (focus ? 1 : 0);
  if (nNotes > 0) used.push(`${focus ? '+' : ''}${nNotes} NOTE${nNotes > 1 ? 'S' : ''}`);

  return { text: lines.join('\n'), used, focusTitle: focus ? focus.title || 'Sans titre' : undefined };
}

export function systemPrompt(context: string, web: boolean, focusTitle?: string): string {
  const focus = focusTitle
    ? `\n\nCONTEXTE PRINCIPAL : l'utilisateur te parle depuis sa note « ${focusTitle} » (section NOTE OUVERTE). Par défaut, « la note », « ça », « ce texte » désignent cette note : réponds d'abord par rapport à elle. N'utilise les autres notes, les habitudes ou le web que si la question le demande ou si cela apporte vraiment quelque chose, et dis-le quand tu le fais.`
    : '';
  const notes = `\n\nLIRE UNE AUTRE NOTE : si tu as besoin du contenu complet d'une note dont tu ne vois que le titre, réponds UNIQUEMENT avec une seule ligne :\n[[note: titre de la note]]`;
  const tools = web
    ? `\n\nACCÈS INTERNET : si tu as besoin d'une information récente, d'un fait que tu ne connais pas avec certitude, ou si l'utilisateur te demande de chercher, réponds UNIQUEMENT avec une seule ligne :\n[[search: ta requête]]\nPour lire une page précise : [[fetch: https://adresse]]\nTu recevras le résultat, puis tu répondras normalement en citant les sources [1], [2]. N'utilise pas ces commandes pour des questions sur les notes ou les habitudes.`
    : '';
  return `Tu es Kairo, l'assistant personnel intégré à l'application de l'utilisateur (habitudes + notes). Tu tournes en local. Réponds en français, de façon claire, chaleureuse et concise (Markdown léger autorisé : listes, gras). Quand l'utilisateur parle de ses habitudes ou de ses notes, appuie-toi sur les données ci-dessous et n'invente rien. Si une image est jointe, décris et explique précisément ce que tu vois.${focus}${notes}${tools}\n\n--- DONNÉES DE L'APP ---\n${context}`;
}

/** Trouve la note la plus proche d'un titre demandé par l'IA. */
export function findNoteByTitle(data: AppData, title: string): Note | undefined {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»"'’]/g, '').trim();
  const t = norm(title);
  return (
    data.notes.find((n) => norm(n.title) === t) ??
    data.notes.find((n) => norm(n.title).includes(t) || (t.length > 3 && t.includes(norm(n.title)) && n.title.length > 2)) ??
    data.notes.map((n) => ({ n, s: scoreNote(n, words(title)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.n
  );
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
