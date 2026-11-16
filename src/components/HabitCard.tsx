import { memo, useMemo } from 'react';
import { useNav } from '../nav';
import { dayKey } from '../lib/dates';
import { habitGrid, totalDone, weekDone } from '../lib/habits';
import { toggleHabitDay } from '../lib/store';
import { Habit } from '../lib/types';
import { Icon } from './Icon';

export function DotGrid({ habit, weeks = 22 }: { habit: Habit; weeks?: number }) {
  const cells = useMemo(() => habitGrid(habit, weeks), [habit, weeks]);
  return (
    <div className="grid" aria-hidden="true">
      {cells.map((c) => (
        <span key={c.key} className={`dot${c.done ? ' on' : ''}${c.today ? ' today' : ''}${c.future ? ' future' : ''}`} />
      ))}
    </div>
  );
}

export const HabitIconBox = ({ habit, size = 40 }: { habit: Habit; size?: number }) => (
  <span style={{ width: size, height: size, borderRadius: 12, background: `color-mix(in srgb, ${habit.color} 16%, var(--surface))`, color: habit.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
    <Icon name={habit.icon} size={20} />
  </span>
);

export const HabitCard = memo(function HabitCard({ habit }: { habit: Habit }) {
  const nav = useNav();
  const today = dayKey();
  const done = !!habit.log[today];
  const wk = weekDone(habit);
  return (
    <div className="card" style={{ ['--c' as any]: habit.color, display: 'flex', flexDirection: 'column', gap: 14, borderRadius: 24 }}>
      <div className="row">
        <button onClick={() => nav.go({ name: 'habit', id: habit.id })} className="row" style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left', color: 'inherit' }} aria-label={`Ouvrir ${habit.name}`}>
          <HabitIconBox habit={habit} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{habit.name}</span>
            {habit.desc && <span style={{ fontSize: 13, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{habit.desc}</span>}
          </span>
        </button>
        <button className={`chk${done ? ' on' : ''}`} aria-pressed={done} aria-label={done ? `${habit.name} : marquer non fait` : `${habit.name} : marquer comme fait`} onClick={() => toggleHabitDay(habit.id, today)}>
          <Icon name="check" size={18} stroke={2.2} />
        </button>
      </div>
      <button onClick={() => nav.go({ name: 'habit', id: habit.id })} style={{ background: 'none', border: 'none', padding: 0 }} aria-label={`Historique de ${habit.name}`}>
        <DotGrid habit={habit} />
      </button>
      <div className="row" style={{ gap: 6, fontFamily: 'var(--mono)', fontSize: 11 }}>
        <span className="row" style={{ gap: 5, padding: '5px 9px', borderRadius: 8, background: `color-mix(in srgb, ${habit.color} 14%, var(--surface))`, color: habit.color }}>
          <Icon name="flame" size={12} stroke={2} />{totalDone(habit)}
        </span>
        <span style={{ padding: '5px 9px', borderRadius: 8, background: '#1c1c20', color: 'var(--muted)' }}>{wk} sur {habit.target} cette semaine</span>
      </div>
    </div>
  );
});
