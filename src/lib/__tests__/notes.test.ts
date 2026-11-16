// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlToMd, mdToHtml, noteMarkdown, notePlain, taskCount } from '../notes';

const RICH = '<h2>Courses</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Lait</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p><strong>Pain</strong> complet</p></div></li></ul><p>Texte <span style="color: #F2877A">rouge</span> et <mark data-color="rgba(242,209,107,0.30)">surligné</mark>.</p><ol><li><p>un</p></li><li><p>deux</p></li></ol>';

describe('notes riches', () => {
  it('HTML de l’éditeur → Markdown lisible par l’IA', () => {
    expect(htmlToMd(RICH)).toBe('## Courses\n\n- [x] Lait\n- [ ] **Pain** complet\n\nTexte rouge et surligné.\n\n1. un\n2. deux');
  });
  it('Markdown de l’IA → cases à cocher de l’éditeur', () => {
    const h = mdToHtml('## Liste\n- [x] fait\n- [ ] à faire\n\n- puce');
    expect(h).toContain('<ul data-type="taskList">');
    expect(h).toContain('data-checked="true"');
    expect(h).toContain('data-checked="false"');
    expect(h).not.toContain('type="checkbox"');
    expect(h).toMatch(/<ul><li>(<p>)?puce/);
  });
  it('aller-retour Markdown → HTML → Markdown', () => {
    const md = '## Titre\n\n- [x] a\n- [ ] b\n\nun **gras** texte';
    expect(htmlToMd(mdToHtml(md))).toBe(md);
  });
  it('texte brut, compte des cases, anciennes notes Markdown', () => {
    const n = { body: RICH, format: 'html' as const };
    expect(notePlain(n)).toContain('Pain complet');
    expect(notePlain(n)).not.toContain('<');
    expect(taskCount(n)).toEqual({ done: 1, total: 2 });
    expect(taskCount({ body: '- [x] a\n- [ ] b\n- [ ] c' })).toEqual({ done: 1, total: 3 });
    expect(noteMarkdown({ body: '# vieux md' })).toBe('# vieux md');
  });
});
