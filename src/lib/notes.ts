// Contenu des notes : HTML riche (éditeur) ou Markdown (anciennes notes, réponses de l'IA).
// L'IA lit toujours une version Markdown ; la recherche utilise le texte brut.
import { marked } from 'marked';
import { Note } from './types';

export const isRich = (n: Pick<Note, 'format'>) => n.format === 'html';

/** Markdown → HTML compatible avec l'éditeur (listes à cocher incluses). */
export function mdToHtml(md: string): string {
  const html = marked.parse(md || '', { gfm: true, breaks: true, async: false }) as string;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const isTask = (li: Element) => !!li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
  Array.from(doc.querySelectorAll('ul')).forEach((ul) => {
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI');
    if (!items.some(isTask)) return;
    // Découpe en groupes consécutifs : cases à cocher → taskList, le reste → liste à puces.
    const groups: { task: boolean; items: Element[] }[] = [];
    items.forEach((li) => {
      const t = isTask(li);
      const last = groups[groups.length - 1];
      if (last && last.task === t) last.items.push(li);
      else groups.push({ task: t, items: [li] });
    });
    const frag = doc.createDocumentFragment();
    groups.forEach((g) => {
      const list = doc.createElement('ul');
      if (g.task) list.setAttribute('data-type', 'taskList');
      g.items.forEach((li) => {
        if (g.task) {
          const box = li.querySelector('input[type="checkbox"]')!;
          li.setAttribute('data-type', 'taskItem');
          li.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false');
          box.remove();
          if (!li.querySelector(':scope > p')) {
            const p = doc.createElement('p');
            while (li.firstChild) p.appendChild(li.firstChild);
            li.appendChild(p);
          }
          li.querySelectorAll(':scope > p').forEach((p) => { p.innerHTML = p.innerHTML.trim(); });
        }
        list.appendChild(li);
      });
      frag.appendChild(list);
    });
    ul.replaceWith(frag);
  });
  return doc.body.innerHTML;
}

function inline(node: Node): string {
  let out = '';
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) {
      out += c.textContent ?? '';
      return;
    }
    if (c.nodeType !== 1) return;
    const el = c as HTMLElement;
    const inner = inline(el);
    switch (el.tagName) {
      case 'STRONG':
      case 'B':
        out += inner.trim() ? `**${inner}**` : inner;
        break;
      case 'EM':
      case 'I':
        out += inner.trim() ? `*${inner}*` : inner;
        break;
      case 'S':
      case 'DEL':
        out += inner.trim() ? `~~${inner}~~` : inner;
        break;
      case 'CODE':
        out += `\`${inner}\``;
        break;
      case 'BR':
        out += '\n';
        break;
      case 'A':
        out += `[${inner}](${el.getAttribute('href') ?? ''})`;
        break;
      case 'INPUT':
      case 'LABEL':
        break;
      default:
        out += inner; // u, mark, span (couleurs) : le texte suffit pour l'IA
    }
  });
  return out;
}

function block(el: Element, depth = 0): string {
  const pad = '  '.repeat(depth);
  switch (el.tagName) {
    case 'H1':
    case 'H2':
    case 'H3':
      return `## ${inline(el).trim()}`;
    case 'P':
      return inline(el).trim();
    case 'BLOCKQUOTE':
      return Array.from(el.children).map((c) => block(c, depth)).join('\n').split('\n').map((l) => `> ${l}`).join('\n');
    case 'PRE':
      return '```\n' + (el.textContent ?? '').replace(/\n$/, '') + '\n```';
    case 'HR':
      return '---';
    case 'UL':
    case 'OL': {
      const task = el.getAttribute('data-type') === 'taskList';
      return Array.from(el.children)
        .filter((li) => li.tagName === 'LI')
        .map((li, i) => {
          const marker = task ? `- [${li.getAttribute('data-checked') === 'true' ? 'x' : ' '}] ` : el.tagName === 'OL' ? `${i + 1}. ` : '- ';
          const parts: string[] = [];
          const nested: string[] = [];
          const walk = (node: Element) =>
            Array.from(node.children).forEach((c) => {
              if (c.tagName === 'UL' || c.tagName === 'OL') nested.push(block(c, depth + 1));
              else if (c.tagName === 'P') parts.push(inline(c).trim());
              else if (c.tagName === 'DIV' || c.tagName === 'LABEL') walk(c);
            });
          walk(li);
          if (!parts.length) parts.push(inline(li).trim());
          return `${pad}${marker}${parts.join(' ')}${nested.length ? '\n' + nested.join('\n') : ''}`;
        })
        .join('\n');
    }
    default:
      return inline(el).trim();
  }
}

/** HTML de l'éditeur → Markdown (pour l'IA et la remise en forme). */
export function htmlToMd(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return Array.from(doc.body.children)
    .map((el) => block(el))
    .filter((s) => s.trim())
    .join('\n\n');
}

/** Contenu en Markdown, quel que soit le format stocké. */
export function noteMarkdown(n: Pick<Note, 'body' | 'format'>): string {
  return isRich(n) ? htmlToMd(n.body) : n.body;
}

/** Texte brut (recherche, aperçus). Sans DOM : simple nettoyage. */
export function notePlain(n: Pick<Note, 'body' | 'format'>): string {
  if (!isRich(n)) return n.body.replace(/[#*_`>~]/g, '').replace(/^\s*-\s\[[ x]\]\s/gim, '');
  return n.body
    .replace(/<\/(p|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Nombre de cases cochées / total (pour l'aperçu dans la liste). */
export function taskCount(n: Pick<Note, 'body' | 'format'>): { done: number; total: number } {
  if (isRich(n)) {
    const total = (n.body.match(/data-type="taskItem"/g) || []).length;
    const done = (n.body.match(/data-checked="true"/g) || []).length;
    return { done, total };
  }
  const total = (n.body.match(/^\s*-\s\[[ x]\]/gim) || []).length;
  const done = (n.body.match(/^\s*-\s\[x\]/gim) || []).length;
  return { done, total };
}
