import { useMemo } from 'react';
import { BottomNav } from '../components/BottomNav';
import { HabitCard } from '../components/HabitCard';
import { Icon } from '../components/Icon';
import { Loader } from '../components/Loader';
import { useNav } from '../nav';
import { dayKey, shortDateLabel } from '../lib/dates';
import { currentStreak, weekDone, weekRatios } from '../lib/habits';
import { upsertHabit, uid, useStore } from '../lib/store';
import { Habit } from '../lib/types';
import { useSession } from '../lib/ai/session';
import { STATUS_LABEL } from '../lib/ai/types';

const SUGGESTIONS: Omit<Habit, 'id' | 'createdAt' | 'log'>[] = [
  { name: 'Sport', desc: 'Musculation, course ou similaire', color: '#8B8CF8', icon: 'sport', target: 4 },
  { name: 'Lecture', desc: 'Lire chaque jour, même 10 pages', color: '#6FCFE0', icon: 'book', target: 7 },
  { name: 'Guitare', desc: 'Au moins 15 minutes', color: '#E9A15B', icon: 'music', target: 5 },
];

function aiHint(habits: Habit[]): { text: string; prompt: string } {
  if (!habits.length) return { text: 'Crée une habitude, puis demande-moi un bilan quand tu veux.', prompt: 'Aide-moi à choisir 3 habitudes utiles à suivre.' };
  const today = dayKey();
  const left = habits.filter((h) => !h.log[today]);
  const best = habits.reduce((a, h) => (currentStreak(h) > currentStreak(a) ? h : a), habits[0]);
  const s = currentStreak(best);
  if (!left.length) return { text: 'Tout est validé aujourd’hui. Je te fais le bilan de la semaine ?', prompt: 'Fais-moi le bilan de ma semaine.' };
  if (s >= 3) return { text: `${best.name} tenu ${s} jours d’affilée. Je te fais le bilan de la semaine ?`, prompt: 'Fais-moi le bilan de ma semaine.' };
  return { text: `Il te reste ${left.map((h) => h.name).slice(0, 2).join(' et ')} aujourd’hui. Besoin d’un coup de pouce ?`, prompt: `Donne-moi un coup de pouce pour faire ${left[0].name} aujourd'hui.` };
}

export function Home() {
  const nav = useNav();
  const habits = useStore((s) => s.habits);
  const session = useSession();
  const hint = useMemo(() => aiHint(habits), [habits]);
  const ratios = useMemo(() => weekRatios(habits), [habits]);
  const bestNow = habits.reduce((m, h) => Math.max(m, currentStreak(h)), 0);
  const weekTotal = habits.reduce((m, h) => m + Math.min(weekDone(h), h.target), 0);
  const weekTarget = habits.reduce((m, h) => m + h.target, 0);
  const ring = 94.2;

  return (
    <div className="screen">
      <div className="scroll page">
        <header className="row" style={{ justifyContent: 'space-between', padding: '0 4px 6px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="label">{shortDateLabel()}</span>
            <h1 className="h1">Aujourd’hui</h1>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="icon-btn" aria-label="Réglages" onClick={() => nav.go({ name: 'settings' })}><Icon name="gear" size={18} /></button>
            <button className="icon-btn accent" aria-label="Nouvelle habitude" onClick={() => nav.go({ name: 'habitForm' })}><Icon name="plus" size={18} stroke={2.2} /></button>
          </div>
        </header>

        <button className="card link" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }} onClick={() => nav.go({ name: 'chat', prefill: session.busy ? undefined : hint.prompt })}>
          <Loader status={session.status} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            <span className="label" style={{ fontSize: 10, color: 'var(--a-soft)' }}>IA · {STATUS_LABEL[session.status]}</span>
            <span style={{ fontSize: 14, lineHeight: 1.35, color: '#d6d6da' }}>{session.busy ? 'Je travaille sur ta demande…' : hint.text}</span>
          </span>
          <span className="muted"><Icon name="chevron" size={18} /></span>
        </button>

        {habits.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" strokeWidth="3" />
                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--a)" strokeWidth="3" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring * (1 - Math.min(1, bestNow / 21))} transform="rotate(-90 18 18)" />
              </svg>
              <div>
                <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.6 }}>{bestNow} <span style={{ fontSize: 14, color: 'var(--dim)', fontWeight: 500 }}>jour{bestNow > 1 ? 's' : ''}</span></div>
                <div style={{ fontSize: 13, color: 'var(--dim)' }}>Meilleure série en cours</div>
              </div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="row" style={{ alignItems: 'flex-end', gap: 4, height: 34 }} aria-hidden="true">
                {ratios.map((r, i) => (
                  <span key={i} style={{ width: 10, borderRadius: 3, height: r < 0 ? 4 : Math.max(5, r * 34), background: r <= 0 ? 'var(--line-2)' : 'color-mix(in srgb, var(--a) 80%, #1e1e22)' }} />
                ))}
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.6 }}>{weekTotal}<span style={{ fontSize: 14, color: 'var(--dim)', fontWeight: 500 }}>/{weekTarget}</span></div>
                <div style={{ fontSize: 13, color: 'var(--dim)' }}>Cette semaine</div>
              </div>
            </div>
          </div>
        )}

        {habits.map((h) => <HabitCard key={h.id} habit={h} />)}

        {habits.length === 0 && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Aucune habitude pour l’instant</span>
            <span style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.45 }}>Ajoute la tienne avec le bouton +, ou démarre avec une suggestion :</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s.name} className="chip" onClick={() => upsertHabit({ ...s, id: uid(), createdAt: Date.now(), log: {} })}>+ {s.name}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <BottomNav active="home" />
    </div>
  );
}
