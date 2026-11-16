import { useMemo, useState } from 'react';
import { DotGrid, HabitIconBox } from '../components/HabitCard';
import { Icon } from '../components/Icon';
import { useNav } from '../nav';
import { addDays, dayKey, MONTHS_LONG, startOfWeek } from '../lib/dates';
import { bestStreak, currentStreak, totalDone, weekDone } from '../lib/habits';
import { toggleHabitDay, useStore } from '../lib/store';

export function HabitDetail({ id }: { id: string }) {
  const nav = useNav();
  const habit = useStore((s) => s.habits.find((h) => h.id === id));
  const allNotes = useStore((s) => s.notes);
  const notes = useMemo(() => allNotes.filter((n) => n.habitId === id), [allNotes, id]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  if (!habit) return <div className="screen page"><button className="btn" onClick={nav.back}>Retour</button></div>;

  const first = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const todayKey = dayKey();
  const now = new Date();

  return (
    <div className="screen" style={{ ['--c' as any]: habit.color }}>
      <div className="scroll page" style={{ paddingBottom: 40 }}>
        <header className="row">
          <button className="icon-btn" aria-label="Retour" onClick={nav.back}><Icon name="back" size={18} /></button>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" aria-label="Demander à l’IA" onClick={() => nav.go({ name: 'chat', prefill: `Analyse mon habitude « ${habit.name} » et donne-moi un conseil concret.` })}><Icon name="spark1" size={18} /></button>
          <button className="icon-btn" aria-label="Modifier" onClick={() => nav.go({ name: 'habitForm', id })}><Icon name="edit" size={18} /></button>
        </header>

        <div className="row">
          <HabitIconBox habit={habit} size={48} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h1 className="h1" style={{ fontSize: 26 }}>{habit.name}</h1>
            {habit.desc && <span style={{ fontSize: 14, color: 'var(--dim)' }}>{habit.desc}</span>}
          </div>
        </div>

        <div className="card"><DotGrid habit={habit} weeks={22} /></div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
          {[
            ['Série', currentStreak(habit)],
            ['Record', bestStreak(habit)],
            ['Semaine', `${weekDone(habit)}/${habit.target}`],
            ['Total', totalDone(habit)],
          ].map(([l, v]) => (
            <div key={l} className="card" style={{ padding: 12, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{v}</span>
              <span className="label" style={{ fontSize: 9.5, letterSpacing: 1 }}>{l}</span>
            </div>
          ))}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{MONTHS_LONG[month.getMonth()]} {month.getFullYear()}</span>
            <div className="row" style={{ gap: 6 }}>
              <button className="icon-btn" aria-label="Mois précédent" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Icon name="back" size={16} /></button>
              <button className="icon-btn" aria-label="Mois suivant" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon name="chevron" size={16} /></button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, textAlign: 'center' }}>
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => <span key={d} style={{ fontSize: 12, color: 'var(--dim)', paddingBottom: 4 }}>{d}</span>)}
            {days.map((d) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === month.getMonth();
              const future = d > now && k !== todayKey;
              const done = !!habit.log[k];
              return (
                <button
                  key={k}
                  disabled={future}
                  aria-pressed={done}
                  aria-label={`${d.getDate()} ${MONTHS_LONG[d.getMonth()]}${done ? ', fait' : ''}`}
                  onClick={() => toggleHabitDay(habit.id, k)}
                  style={{
                    height: 40, borderRadius: 12, fontSize: 14, fontWeight: done ? 600 : 400,
                    border: k === todayKey ? '1.5px solid var(--c)' : '1px solid transparent',
                    background: done ? 'color-mix(in srgb, var(--c) 28%, var(--surface))' : 'transparent',
                    color: !inMonth || future ? '#4a4a52' : done ? 'var(--text)' : 'var(--muted)',
                  }}
                >{d.getDate()}</button>
              );
            })}
          </div>
          <span style={{ fontSize: 12, color: 'var(--dim)', textAlign: 'center' }}>Touche un jour pour le valider ou l’annuler</span>
        </div>

        {notes.length > 0 && (
          <>
            <span className="label" style={{ paddingTop: 6 }}>Notes liées</span>
            {notes.map((n) => (
              <button key={n.id} className="card link" onClick={() => nav.go({ name: 'note', id: n.id })}>
                <span style={{ fontWeight: 600 }}>{n.title || 'Sans titre'}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
