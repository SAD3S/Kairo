import { addDays, dayKey, parseKey, startOfWeek } from './dates';
import { Habit } from './types';

/** Série en cours : jours consécutifs validés jusqu'à aujourd'hui
 *  (si aujourd'hui n'est pas encore fait, on compte jusqu'à hier). */
export function currentStreak(h: Habit, today = new Date()): number {
  let d = new Date(today);
  if (!h.log[dayKey(d)]) d = addDays(d, -1);
  let n = 0;
  while (h.log[dayKey(d)]) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function bestStreak(h: Habit): number {
  const keys = Object.keys(h.log).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of keys) {
    if (prev && dayKey(addDays(parseKey(prev), 1)) === k) run++;
    else run = 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

export function totalDone(h: Habit): number {
  return Object.keys(h.log).length;
}

export function weekDone(h: Habit, today = new Date()): number {
  const start = startOfWeek(today);
  let n = 0;
  for (let i = 0; i < 7; i++) if (h.log[dayKey(addDays(start, i))]) n++;
  return n;
}

export interface GridCell {
  key: string;
  done: boolean;
  future: boolean;
  today: boolean;
}

/** Grille façon "contributions" : `weeks` colonnes (de la plus ancienne à
 *  la semaine en cours), 7 lignes (lundi → dimanche). */
export function habitGrid(h: Habit, weeks = 22, today = new Date()): GridCell[] {
  const start = addDays(startOfWeek(today), -7 * (weeks - 1));
  const tKey = dayKey(today);
  const cells: GridCell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const key = dayKey(d);
    cells.push({ key, done: !!h.log[key], future: d > today && key !== tKey, today: key === tKey });
  }
  return cells;
}

/** Pour chaque jour de la semaine en cours : part des habitudes faites (0..1). */
export function weekRatios(habits: Habit[], today = new Date()): number[] {
  const start = startOfWeek(today);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    if (d > today) return -1;
    if (!habits.length) return 0;
    const k = dayKey(d);
    return habits.filter((h) => h.log[k]).length / habits.length;
  });
}

/** Résumé texte compact, utilisé dans le contexte de l'IA. */
export function habitSummary(h: Habit, today = new Date()): string {
  const last14 = Array.from({ length: 14 }, (_, i) => (h.log[dayKey(addDays(today, i - 13))] ? '■' : '□')).join('');
  return `- ${h.name}${h.desc ? ` (${h.desc})` : ''} — objectif ${h.target}/sem · cette semaine ${weekDone(h, today)}/${h.target} · série ${currentStreak(h, today)} j · record ${bestStreak(h)} j · total ${totalDone(h)} · aujourd'hui ${h.log[dayKey(today)] ? 'fait' : 'pas encore fait'} · 14 derniers jours (ancien→aujourd'hui) ${last14}`;
}
