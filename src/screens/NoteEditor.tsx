import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Icon } from '../components/Icon';
import { Loader } from '../components/Loader';
import { useNav } from '../nav';
import { relativeLabel } from '../lib/dates';
import { deleteNote, getState, upsertNote, useStore } from '../lib/store';
import { reformatNote } from '../lib/ai/agent';
import { errorText } from '../lib/ai/session';
import { AiStatus, STATUS_LABEL } from '../lib/ai/types';
import { Note } from '../lib/types';

type Phase = 'edit' | 'loading' | 'review';

export function NoteEditor({ id }: { id: string }) {
  const nav = useNav();
  const stored = useStore((s) => s.notes.find((n) => n.id === id));
  const habits = useStore((s) => s.habits);
  const [note, setNote] = useState<Note | undefined>(stored);
  const [preview, setPreview] = useState(() => !!stored?.body);
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
    if (n && !n.title.trim() && !n.body.trim()) deleteNote(id);
  }, [id]);

  if (!note) return <div className="screen page"><button className="btn" onClick={nav.back}>Retour</button></div>;
  const set = (p: Partial<Note>) => setNote((n) => (n ? { ...n, ...p } : n));

  const format = async () => {
    if (!note.body.trim()) return;
    setErr('');
    setFormatted('');
    setPhase('loading');
    abort.current = new AbortController();
    try {
      const out = await reformatNote(getState(), note.title, note.body, {
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
    set({ body: formatted });
    setPreview(true);
    setPhase('edit');
  };

  return (
    <div className="screen">
      <header className="row" style={{ padding: 'calc(var(--top) + 10px) 16px 8px', gap: 10 }}>
        <button className="icon-btn" aria-label="Retour aux notes" onClick={nav.back}><Icon name="back" size={18} /></button>
        <span className="label" style={{ flex: 1 }}>{relativeLabel(note.updatedAt)}{note.tags.length ? ` · ${note.tags[0]}` : ''}</span>
        {phase === 'edit' && (
          <button className="icon-btn" aria-label={preview ? 'Modifier le texte' : 'Aperçu'} onClick={() => setPreview((p) => !p)}><Icon name={preview ? 'edit' : 'note'} size={18} /></button>
        )}
        <button className="icon-btn" aria-label="Plus d’options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="more" size={18} /></button>
      </header>

      <div className="scroll" style={{ flex: 1, padding: '8px 22px 120px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input aria-label="Titre" placeholder="Titre" value={note.title} onChange={(e) => set({ title: e.target.value })}
          style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 28, fontWeight: 700, letterSpacing: -0.7, padding: 0 }} />

        {phase === 'edit' && (preview ? (
          <div className="md" onClick={() => setPreview(false)} style={{ minHeight: 200 }}>
            {note.body ? <Markdown>{note.body}</Markdown> : <span className="muted">Touche pour écrire…</span>}
          </div>
        ) : (
          <textarea aria-label="Contenu de la note" autoFocus={!note.body} placeholder="Écris en vrac, l’IA remettra en forme…" value={note.body}
            onChange={(e) => set({ body: e.target.value })}
            style={{ flex: 1, minHeight: 320, border: 'none', background: 'transparent', outline: 'none', resize: 'none', fontSize: 15, lineHeight: 1.6, color: 'var(--text-2)', padding: 0 }} />
        ))}

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

      <div className="row" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(var(--bottom) + 14px)', gap: 8, background: 'var(--bg)', borderTop: '1px solid #1c1c20' }}>
        {phase === 'edit' && (
          <>
            <button className="btn primary" style={{ flex: 1 }} disabled={!note.body.trim()} onClick={format}><Icon name="spark1" size={16} stroke={2} />Remettre en forme</button>
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
