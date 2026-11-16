import { useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { Placeholder } from '@tiptap/extensions';
import { Icon } from './Icon';

export const TEXT_COLORS = [
  { name: 'Rouge', value: '#F2877A' },
  { name: 'Orange', value: '#F0A35E' },
  { name: 'Jaune', value: '#F2D16B' },
  { name: 'Vert', value: '#7BD88F' },
  { name: 'Bleu', value: '#6FB7F2' },
  { name: 'Violet', value: '#B9A6FB' },
];
export const HIGHLIGHTS = [
  { name: 'Rouge', value: 'rgba(242,135,122,0.30)' },
  { name: 'Orange', value: 'rgba(240,163,94,0.30)' },
  { name: 'Jaune', value: 'rgba(242,209,107,0.30)' },
  { name: 'Vert', value: 'rgba(123,216,143,0.28)' },
  { name: 'Bleu', value: 'rgba(111,183,242,0.30)' },
  { name: 'Violet', value: 'rgba(185,166,251,0.30)' },
];

export function useRichEditor(html: string, onChange: (html: string) => void, autoFocus: boolean) {
  return useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: 'Écris ici… (l’IA peut remettre en forme)' }),
    ],
    content: html,
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { class: 'rt', 'aria-label': 'Contenu de la note', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getHTML()),
  });
}

export function RichContent({ editor }: { editor: Editor | null }) {
  return <EditorContent editor={editor} />;
}

/** Barre d'outils : titres, gras, italique, souligné, barré, couleurs, listes, cases à cocher. */
export function Toolbar({ editor }: { editor: Editor | null }) {
  const [palette, setPalette] = useState(false);
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            h: e.isActive('heading'),
            b: e.isActive('bold'),
            i: e.isActive('italic'),
            u: e.isActive('underline'),
            s: e.isActive('strike'),
            task: e.isActive('taskList'),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            color: (e.getAttributes('textStyle').color as string | undefined) ?? '',
            mark: (e.getAttributes('highlight').color as string | undefined) ?? '',
            canUndo: e.can().undo(),
          }
        : null,
  });
  if (!editor || !st) return null;

  // Empêche le clavier de se fermer quand on touche un bouton.
  const keep = (e: React.PointerEvent) => e.preventDefault();
  const btn = (label: string, active: boolean, run: () => void, child: React.ReactNode) => (
    <button type="button" className={`tb ${active ? 'on' : ''}`} aria-label={label} aria-pressed={active} onPointerDown={keep} onClick={run}>
      {child}
    </button>
  );
  const chain = () => editor.chain().focus();

  return (
    <div style={{ position: 'relative' }}>
      {palette && (
        <div className="palette glass rise" role="dialog" aria-label="Couleurs" onPointerDown={keep}>
          <span className="label" style={{ fontSize: 10 }}>Texte</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className={`sw ${!st.color ? 'on' : ''}`} aria-label="Couleur par défaut" onClick={() => chain().unsetColor().run()} style={{ background: 'var(--text)' }} />
            {TEXT_COLORS.map((c) => (
              <button type="button" key={c.value} className={`sw ${st.color === c.value ? 'on' : ''}`} aria-label={`Texte ${c.name}`} onClick={() => chain().setColor(c.value).run()} style={{ background: c.value }} />
            ))}
          </div>
          <span className="label" style={{ fontSize: 10, marginTop: 4 }}>Surligner</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className={`sw ${!st.mark ? 'on' : ''}`} aria-label="Sans surlignage" onClick={() => chain().unsetHighlight().run()} style={{ background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>
              <Icon name="close" size={14} />
            </button>
            {HIGHLIGHTS.map((c) => (
              <button type="button" key={c.value} className={`sw ${st.mark === c.value ? 'on' : ''}`} aria-label={`Surligner en ${c.name.toLowerCase()}`} onClick={() => chain().setHighlight({ color: c.value }).run()} style={{ background: c.value }} />
            ))}
          </div>
        </div>
      )}
      <div className="toolbar scroll" role="toolbar" aria-label="Mise en forme">
        {btn('Case à cocher', st.task, () => chain().toggleTaskList().run(), <Icon name="checklist" size={19} />)}
        {btn('Intertitre', st.h, () => chain().toggleHeading({ level: 2 }).run(), <span style={{ fontWeight: 700, fontSize: 15 }}>T</span>)}
        {btn('Gras', st.b, () => chain().toggleBold().run(), <span style={{ fontWeight: 800 }}>B</span>)}
        {btn('Italique', st.i, () => chain().toggleItalic().run(), <span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: 17 }}>I</span>)}
        {btn('Souligné', st.u, () => chain().toggleUnderline().run(), <span style={{ textDecoration: 'underline' }}>U</span>)}
        {btn('Barré', st.s, () => chain().toggleStrike().run(), <span style={{ textDecoration: 'line-through' }}>S</span>)}
        {btn('Couleurs', palette, () => setPalette((p) => !p), (
          <span style={{ position: 'relative', display: 'flex' }}>
            <Icon name="palette" size={19} />
            <span style={{ position: 'absolute', right: -3, bottom: -3, width: 8, height: 8, borderRadius: 4, background: st.color || st.mark || 'transparent' }} />
          </span>
        ))}
        {btn('Liste à puces', st.bullet, () => chain().toggleBulletList().run(), <Icon name="listBullet" size={19} />)}
        {btn('Liste numérotée', st.ordered, () => chain().toggleOrderedList().run(), <Icon name="listNum" size={19} />)}
        {btn('Annuler', false, () => chain().undo().run(), <span style={{ opacity: st.canUndo ? 1 : 0.35, display: 'flex' }}><Icon name="undo" size={18} /></span>)}
      </div>
    </div>
  );
}
