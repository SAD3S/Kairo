import { useMemo, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { Icon } from '../components/Icon';
import { useNav } from '../nav';
import { relativeLabel } from '../lib/dates';
import { scoreNote, words } from '../lib/ai/context';
import { uid, upsertNote, useStore } from '../lib/store';
import { Note } from '../lib/types';

export function needsFormatting(n: Note) {
  return n.body.length > 80 && !/^(#{1,3} |[-*] |\d+\. )/m.test(n.body);
}

function excerpt(body: string) {
  return body.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function newNote(go: (id: string) => void, habitId?: string) {
  const now = Date.now();
  const n: Note = { id: uid(), title: '', body: '', tags: [], pinned: false, habitId, createdAt: now, updatedAt: now };
  upsertNote(n);
  go(n.id);
}

export function Notes() {
  const nav = useNav();
  const notes = useStore((s) => s.notes);
  const habits = useStore((s) => s.habits);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);

  const tags = useMemo(() => Array.from(new Set(notes.flatMap((n) => n.tags))).slice(0, 12), [notes]);
  const list = useMemo(() => {
    let l = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    if (tag) l = l.filter((n) => n.tags.includes(tag));
    const w = words(q);
    if (w.length) l = l.map((n) => ({ n, s: scoreNote(n, w) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.n);
    return l;
  }, [notes, q, tag]);
  const pinned = list.filter((n) => n.pinned);
  const recent = list.filter((n) => !n.pinned);
  const open = (id: string) => nav.go({ name: 'note', id });

  return (
    <div className="screen">
      <div className="scroll page">
        <header className="row" style={{ justifyContent: 'space-between', padding: '0 4px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="label">{notes.length} note{notes.length > 1 ? 's' : ''}</span>
            <h1 className="h1">Notes</h1>
          </div>
          <button className="icon-btn accent" aria-label="Nouvelle note" onClick={() => newNote(open)}><Icon name="plus" size={18} stroke={2.2} /></button>
        </header>

        <label className="row input" style={{ gap: 10, color: 'var(--dim)', height: 46 }}>
          <Icon name="search" size={18} />
          <input aria-label="Rechercher dans les notes" placeholder="Chercher dans les notes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 15, color: 'var(--text)' }} />
          {q && <button className="tag" onClick={() => setQ('')}>EFFACER</button>}
        </label>

        {tags.length > 0 && (
          <div className="scroll row" style={{ gap: 8, overflowX: 'auto', margin: '0 -16px', padding: '0 16px' }}>
            <button className={`chip ${tag === null ? 'on' : ''}`} onClick={() => setTag(null)}>Toutes</button>
            {tags.map((t) => <button key={t} className={`chip ${tag === t ? 'on' : ''}`} onClick={() => setTag(t)}>{t}</button>)}
          </div>
        )}

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
            {n.body && <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--muted)' }}>{excerpt(n.body)}</span>}
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>{relativeLabel(n.updatedAt)}{n.tags.length ? ` · ${n.tags.join(' · ').toUpperCase()}` : ''}</span>
          </button>
        ))}
        {list.length === 0 && <p className="muted" style={{ textAlign: 'center', marginTop: 30 }}>{q || tag ? 'Aucune note trouvée.' : 'Pas encore de note.'}</p>}
      </div>
      <BottomNav active="notes" />
    </div>
  );
}
