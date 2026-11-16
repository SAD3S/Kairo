import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Icon } from '../components/Icon';
import { Loader } from '../components/Loader';
import { FolderSheet } from '../components/FolderSheet';
import { useNav } from '../nav';
import { relativeLabel } from '../lib/dates';
import { deleteNote, getState, upsertNote, useStore } from '../lib/store';
import { reformatNote } from '../lib/ai/agent';
import { errorText } from '../lib/ai/session';
import { AiStatus, STATUS_LABEL } from '../lib/ai/types';
import { Note } from '../lib/types';
import { isRich, mdToHtml, noteMarkdown, notePlain } from '../lib/notes';
import { RichContent, Toolbar, useRichEditor } from '../components/RichEditor';

type Phase = 'edit' | 'loading' | 'review';

export function NoteEditor({ id }: { id: string }) {
  const nav = useNav();
  const stored = useStore((s) => s.notes.find((n) => n.id === id));
  const habits = useStore((s) => s.habits);
  const folders = useStore((s) => s.folders);
  const [folderSheet, setFolderSheet] = useState(false);
  const [note, setNote] = useState<Note | undefined>(stored);
  const [phase, setPhase] = useState<Phase>('edit');
  const [status, setStatus] = useState<AiStatus>('format');
  const [sub, setSub] = useState<string | undefined>();
  const [formatted, setFormatted] = useState('');
  const [err, setErr] = useState('');
  const [menu, setMenu] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const noteRef = useRef(note);
  const dirty = useRef(false);
  const deleted = useRef(false);
  noteRef.current = note;

  // Éditeur riche : les anciennes notes Markdown sont converties à l'ouverture.
  const editor = useRichEditor(
    stored ? (isRich(stored) ? stored.body : mdToHtml(stored.body)) : '',
    (html) => setNote((n) => (n ? { ...n, body: html, format: 'html' } : n)),
    !!stored && !stored.body && !!stored.title,
  );

  // Sauvegarde automatique.
  useEffect(() => {
    if (!note || note === stored) return;
    dirty.current = true;
    const t = setTimeout(() => {
      upsertNote({ ...note, updatedAt: Date.now() });
      dirty.current = false;
    }, 400);
    return () => clearTimeout(t);
  }, [note]); // eslint-disable-line react-hooks/exhaustive-deps

  // En quittant : enregistre ce qui reste, et supprime une note vide.
  useEffect(() => () => {
    abort.current?.abort();
    if (deleted.current) return;
    if (dirty.current && noteRef.current) upsertNote({ ...noteRef.current, updatedAt: Date.now() });
    const n = getState().notes.find((x) => x.id === id);
    if (n && !n.title.trim() && !notePlain(n).trim() && !n.body.includes('taskItem')) deleteNote(id);
  }, [id]);

  if (!note) return <div className="screen page"><button className="btn" onClick={nav.back}>Retour</button></div>;
  const set = (p: Partial<Note>) => setNote((n) => (n ? { ...n, ...p } : n));

  const format = async () => {
    if (!notePlain(note).trim()) return;
    setErr('');
    setFormatted('');
    setPhase('loading');
    abort.current = new AbortController();
    try {
      const out = await reformatNote(getState(), note.title, noteMarkdown(note), {
        signal: abort.current.signal,
        onStatus: (s, sb) => { setStatus(s); setSub(sb); },
        onText: setFormatted,
      });
      if (!out) throw new Error('Réponse vide.');
      setFormatted(out);
      setPhase('review');
    } catch (e: any) {
      setPhase('edit');
      if (e?.name !== 'AbortError') setErr(errorText(e).replace(/\*\*/g, ''));
    }
  };

  const keep = () => {
    const html = mdToHtml(formatted);
    editor?.commands.setContent(html);
    set({ body: editor ? editor.getHTML() : html, format: 'html' });
    setPhase('edit');
  };

  return (
    <div className="screen">
      <header className="row" style={{ padding: 'calc(var(--top) + 10px) 16px 8px', gap: 10 }}>
        <button className="icon-btn" aria-label="Retour aux notes" onClick={nav.back}><Icon name="back" size={18} /></button>
        <span className="label" style={{ flex: 1 }}>{relativeLabel(note.updatedAt)}{note.tags.length ? ` · ${note.tags[0]}` : ''}</span>
        <button className="icon-btn" aria-label="Plus d’options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="more" size={18} /></button>
      </header>

      <div className="scroll" style={{ flex: 1, padding: '8px 22px 190px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input aria-label="Titre" placeholder="Titre" value={note.title} onChange={(e) => set({ title: e.target.value })}
          style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 28, fontWeight: 700, letterSpacing: -0.7, padding: 0 }} />
        {(() => {
          const f = folders.find((x) => x.id === note.folderId);
          return (
            <button onClick={() => setFolderSheet(true)} aria-label={f ? `Dossier : ${f.name}. Changer` : 'Ranger dans un dossier'}
              style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line)', background: f ? 'color-mix(in srgb, var(--a) 12%, var(--surface))' : 'transparent', color: f ? 'var(--a-soft)' : 'var(--dim)', fontSize: 13, fontWeight: 500, marginTop: -4 }}>
              <Icon name={f ? 'folder' : 'folderPlus'} size={15} />{f ? f.name : 'Dossier'}
            </button>
          );
        })()}

        <div style={{ display: phase === 'edit' ? 'block' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) editor?.commands.focus('end'); }}>
          <RichContent editor={editor} />
        </div>

        {phase === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row card" style={{ gap: 12, padding: '12px 14px', borderRadius: 16 }} role="status">
              <Loader status={status} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{STATUS_LABEL[status]}</span>
                {sub && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#9a9aa3' }}>{sub}</span>}
              </span>
            </div>
            {formatted ? (
              <div className="md"><Markdown>{formatted}</Markdown><span className="caret" aria-hidden="true" /></div>
            ) : (
              [40, 92, 78, 85, 35, 60].map((w, i) => <span key={i} className="ghost" style={{ width: `${w}%`, animationDelay: `${i * 0.1}s`, marginTop: i === 4 ? 10 : 0 }} />)
            )}
          </div>
        )}

        {phase === 'review' && (
          <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span className="tag accent" style={{ alignSelf: 'flex-start' }}>PROPOSITION DE L’IA</span>
            <div className="md"><Markdown>{formatted}</Markdown></div>
          </div>
        )}
        {err && <p className="err">{err}</p>}
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 16px calc(var(--bottom) + 14px)', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg)', borderTop: '1px solid #1c1c20' }}>
        {phase === 'edit' && <Toolbar editor={editor} />}
        <div className="row" style={{ gap: 8 }}>
        {phase === 'edit' && (
          <>
            <button className="btn primary" style={{ flex: 1 }} disabled={!notePlain(note).trim()} onClick={format}><Icon name="spark1" size={16} stroke={2} />Remettre en forme</button>
            <button className="btn" style={{ width: 44, padding: 0 }} aria-label="Demander à l’IA à propos de cette note" onClick={() => nav.go({ name: 'chat', noteId: note.id })}><Icon name="chat" size={18} /></button>
          </>
        )}
        {phase === 'loading' && <button className="btn" style={{ flex: 1 }} onClick={() => abort.current?.abort()}>Annuler</button>}
        {phase === 'review' && (
          <>
            <button className="btn" style={{ flex: 1 }} onClick={() => setPhase('edit')}><Icon name="undo" size={16} />Garder l’original</button>
            <button className="btn primary" style={{ flex: 1 }} onClick={keep}>Remplacer</button>
          </>
        )}
        </div>
      </div>

      {folderSheet && <FolderSheet currentId={note.folderId} onPick={(id) => set({ folderId: id })} onClose={() => setFolderSheet(false)} />}

      {menu && (
        <div className="sheet-back" onClick={() => setMenu(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Options de la note">
            <span className="grip" />
            <button className="btn" onClick={() => { set({ pinned: !note.pinned }); setMenu(false); }}><Icon name="pin" size={16} />{note.pinned ? 'Désépingler' : 'Épingler'}</button>
            <label className="field">
              <span className="label">Tags (séparés par des virgules)</span>
              <input className="input" defaultValue={note.tags.join(', ')} onBlur={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6) })} placeholder="Idées, Lecture…" />
            </label>
            {habits.length > 0 && (
              <label className="field">
                <span className="label">Lier à une habitude</span>
                <select className="input" value={note.habitId ?? ''} onChange={(e) => set({ habitId: e.target.value || undefined })}>
                  <option value="">Aucune</option>
                  {habits.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </label>
            )}
            <button className="btn danger" onClick={() => { deleted.current = true; deleteNote(note.id); nav.back(); }}><Icon name="trash" size={16} />Supprimer la note</button>
          </div>
        </div>
      )}
    </div>
  );
}
