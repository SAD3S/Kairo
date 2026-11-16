import { useState } from 'react';
import { HABIT_ICONS, Icon } from '../components/Icon';
import { useNav } from '../nav';
import { deleteHabit, getState, uid, upsertHabit } from '../lib/store';
import { Habit } from '../lib/types';

const COLORS = ['#8B8CF8', '#6FCFE0', '#E9A15B', '#7BD88F', '#F2877A', '#E58FD0', '#F2D16B', '#A8A8B0'];

export function HabitForm({ id }: { id?: string }) {
  const nav = useNav();
  const existing = id ? getState().habits.find((h) => h.id === id) : undefined;
  const [h, setH] = useState<Habit>(
    existing ?? { id: uid(), name: '', desc: '', color: COLORS[0], icon: 'sport', target: 7, createdAt: Date.now(), log: {} },
  );
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (p: Partial<Habit>) => setH((x) => ({ ...x, ...p }));

  const save = () => {
    if (!h.name.trim()) return;
    upsertHabit({ ...h, name: h.name.trim(), desc: h.desc.trim() });
    nav.back();
  };

  return (
    <div className="screen" style={{ ['--c' as any]: h.color }}>
      <div className="scroll page" style={{ paddingBottom: 40, gap: 20 }}>
        <header className="row">
          <button className="icon-btn" aria-label="Annuler" onClick={nav.back}><Icon name="close" size={18} /></button>
          <h1 className="h1" style={{ fontSize: 22, flex: 1 }}>{existing ? 'Modifier' : 'Nouvelle habitude'}</h1>
          <button className="btn primary small" disabled={!h.name.trim()} onClick={save}>Enregistrer</button>
        </header>

        <label className="field">
          <span className="label">Nom</span>
          <input className="input" autoFocus={!existing} value={h.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex. Méditation" maxLength={40} />
        </label>
        <label className="field">
          <span className="label">Description</span>
          <input className="input" value={h.desc} onChange={(e) => set({ desc: e.target.value })} placeholder="Ex. 10 minutes le matin" maxLength={80} />
        </label>

        <div className="field">
          <span className="label">Couleur</span>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button key={c} aria-label={`Couleur ${c}`} aria-pressed={h.color === c} onClick={() => set({ color: c })}
                style={{ width: 40, height: 40, borderRadius: 12, background: c, border: h.color === c ? '3px solid var(--text)' : '3px solid transparent' }} />
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Icône</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
            {HABIT_ICONS.map((ic) => (
              <button key={ic} aria-label={`Icône ${ic}`} aria-pressed={h.icon === ic} onClick={() => set({ icon: ic })}
                style={{ height: 48, borderRadius: 14, border: '1px solid var(--line)', background: h.icon === ic ? 'color-mix(in srgb, var(--c) 22%, var(--surface))' : 'var(--surface)', color: h.icon === ic ? 'var(--c)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={ic} />
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Objectif : {h.target} jour{h.target > 1 ? 's' : ''} par semaine</span>
          <div className="seg">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button key={n} className={h.target === n ? 'on' : ''} onClick={() => set({ target: n })}>{n}</button>
            ))}
          </div>
        </div>

        {existing && (
          confirmDel ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmDel(false)}>Garder</button>
              <button className="btn danger" style={{ flex: 1 }} onClick={() => { deleteHabit(existing.id); nav.tab({ name: 'home' }); }}>Supprimer définitivement</button>
            </div>
          ) : (
            <button className="btn danger" onClick={() => setConfirmDel(true)}><Icon name="trash" size={16} />Supprimer l’habitude</button>
          )
        )}
      </div>
    </div>
  );
}
