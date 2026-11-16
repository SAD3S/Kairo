import { useMemo, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { Icon } from '../components/Icon';
import { useNav } from '../nav';
import { relativeLabel } from '../lib/dates';
import { scoreNote, words } from '../lib/ai/context';
import { createFolder, deleteFolder, renameFolder, uid, upsertNote, useStore } from '../lib/store';
import { FolderEditSheet } from '../components/FolderSheet';
import { Note } from '../lib/types';
import { notePlain, taskCount } from '../lib/notes';

export function needsFormatting(n: Note) {
  if (n.format === 'html') return notePlain(n).length > 120 && !/<(h[1-3]|ul|ol)/.test(n.body);
  return n.body.length > 80 && !/^(#{1,3} |[-*] |\d+\. )/m.test(n.body);
}

function excerpt(n: Note) {
  return notePlain(n).replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function newNote(go: (id: string) => void, habitId?: string, folderId?: string) {
  const now = Date.now();
  const n: Note = { id: uid(), title: '', body: '', tags: [], pinned: false, habitId, folderId, createdAt: now, updatedAt: now };
  upsertNote(n);
  go(n.id);
}

export function Notes() {
  const nav = useNav();
  const notes = useStore((s) => s.notes);
  const habits = useStore((s) => s.habits);
  const folders = useStore((s) => s.folders);
  const [q, setQ] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'new' | 'edit' | null>(null);
  const folder = folders.find((f) => f.id === folderId);
  const folderName = (id?: string) => folders.find((f) => f.id === id)?.name;
  const countIn = (id: string) => notes.filter((n) => n.folderId === id).length;

  const list = useMemo(() => {
    let l = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    if (folderId) l = l.filter((n) => n.folderId === folderId);
    const w = words(q);
    if (w.length) l = l.map((n) => ({ n, s: scoreNote(n, w, folderName(n.folderId)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.n);
    return l;
  }, [notes, q, folderId, folders]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinned = list.filter((n) => n.pinned);
  const recent = list.filter((n) => !n.pinned);
  const open = (id: string) => nav.go({ name: 'note', id });

  return (
    <div className="screen">
      <div className="scroll page">
        <header className="row" style={{ justifyContent: 'space-between', padding: '0 4px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="label">{folder ? `Dossier · ${list.length} note${list.length > 1 ? 's' : ''}` : `${notes.length} note${notes.length > 1 ? 's' : ''}`}</span>
            <h1 className="h1" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 230 }}>{folder ? folder.name : 'Notes'}</h1>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {folder && <button className="icon-btn" aria-label={`Modifier le dossier ${folder.name}`} onClick={() => setSheet('edit')}><Icon name="more" size={18} /></button>}
            <button className="icon-btn accent" aria-label={folder ? `Nouvelle note dans ${folder.name}` : 'Nouvelle note'} onClick={() => newNote(open, undefined, folderId ?? undefined)}><Icon name="plus" size={18} stroke={2.2} /></button>
          </div>
        </header>

        <label className="row input" style={{ gap: 10, color: 'var(--dim)', height: 46 }}>
          <Icon name="search" size={18} />
          <input aria-label="Rechercher dans les notes" placeholder="Chercher dans les notes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 15, color: 'var(--text)' }} />
          {q && <button className="tag" onClick={() => setQ('')}>EFFACER</button>}
        </label>

        <div className="scroll row" style={{ gap: 8, overflowX: 'auto', margin: '0 -16px', padding: '0 16px' }} role="tablist" aria-label="Dossiers">
          <button role="tab" aria-selected={folderId === null} className={`chip ${folderId === null ? 'on' : ''}`} onClick={() => setFolderId(null)}>Toutes</button>
          {folders.map((f) => (
            <button key={f.id} role="tab" aria-selected={folderId === f.id} className={`chip ${folderId === f.id ? 'on' : ''}`} onClick={() => setFolderId(f.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="folder" size={14} />{f.name}<span style={{ opacity: 0.6, fontFamily: 'var(--mono)', fontSize: 11 }}>{countIn(f.id)}</span>
            </button>
          ))}
          <button className="chip" aria-label="Nouveau dossier" onClick={() => setSheet('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="folderPlus" size={15} />{folders.length ? '' : 'Nouveau dossier'}
          </button>
        </div>

        {pinned.length > 0 && (
          <>
            <span className="label" style={{ padding: '6px 4px 0' }}>Épinglées</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              {pinned.map((n) => {
                const h = habits.find((x) => x.id === n.habitId);
                return (
                  <button key={n.id} className="card link" onClick={() => open(n.id)} style={{ minHeight: 120, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: h?.color ?? 'var(--a)' }}><Icon name={h?.icon ?? 'pin'} size={18} /></span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{n.title || 'Sans titre'}</span>
                      <span style={{ fontSize: 12, color: 'var(--dim)' }}>{h ? `lié à ${h.name}` : relativeLabel(n.updatedAt)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {recent.length > 0 && <span className="label" style={{ padding: '6px 4px 0' }}>{q ? 'Résultats' : 'Récentes'}</span>}
        {recent.map((n) => (
          <button key={n.id} className="card link" onClick={() => open(n.id)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{n.title || 'Sans titre'}</span>
              {needsFormatting(n) && <span className="tag accent">À REMETTRE EN FORME</span>}
            </span>
            {n.body && <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--muted)' }}>{excerpt(n)}</span>}
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>{(() => { const t = taskCount(n); return t.total ? `☑ ${t.done}/${t.total} · ` : ''; })()}{relativeLabel(n.updatedAt)}{!folderId && folderName(n.folderId) ? ` · ${folderName(n.folderId)!.toUpperCase()}` : ''}{n.tags.length ? ` · ${n.tags.join(' · ').toUpperCase()}` : ''}</span>
          </button>
        ))}
        {list.length === 0 && <p className="muted" style={{ textAlign: 'center', marginTop: 30 }}>{q ? 'Aucune note trouvée.' : folder ? 'Ce dossier est vide. Touche + pour y écrire une note.' : 'Pas encore de note.'}</p>}
      </div>
      {sheet === 'new' && <FolderEditSheet onSave={(name) => setFolderId(createFolder(name))} onClose={() => setSheet(null)} />}
      {sheet === 'edit' && folder && (
        <FolderEditSheet initial={folder.name} onSave={(name) => renameFolder(folder.id, name)} onDelete={() => { deleteFolder(folder.id); setFolderId(null); }} onClose={() => setSheet(null)} />
      )}
      <BottomNav active="notes" />
    </div>
  );
}
