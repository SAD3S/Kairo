import { useSyncExternalStore } from 'react';
import { get, set } from 'idb-keyval';
import { isNativeAndroid } from './ai/native';
import { AppData, ChatMsg, DEFAULT_SETTINGS, Folder, Habit, Note, Settings } from './types';

const KEY = 'kairo-data-v1';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function welcomeNote(): Note {
  const now = Date.now();
  return {
    id: uid(),
    title: 'Bienvenue dans Kairo',
    body:
      "## Ce que l'IA peut faire\n- Lire tes notes et tes habitudes pour te répondre\n- Regarder ce que tu montres à la caméra et l'expliquer\n- Remettre une note en forme (titres, listes, fautes)\n- Chercher sur le web si tu l'actives dans les réglages\n\n## Pour commencer\n1. Ouvre les réglages (roue dentée) et choisis où tourne l'IA\n2. Crée ta première habitude avec le bouton +\n3. Écris une note en vrac et touche « Remettre en forme »",
    tags: ['Guide'],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function emptyData(): AppData {
  return { version: 1, habits: [], notes: [welcomeNote()], folders: [], chat: [], settings: { ...DEFAULT_SETTINGS, backend: isNativeAndroid() ? 'device' : 'ollama' } };
}

let state: AppData = emptyData();
let loaded = false;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  listeners.forEach((l) => l());
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    set(KEY, state).catch((e) => console.error('Sauvegarde impossible', e));
  }, 250);
}

/** Normalise des données venant du disque ou d'un import. */
export function sanitize(raw: any): AppData {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: 1,
    habits: Array.isArray(raw.habits) ? raw.habits.filter((h: any) => h && h.id && h.name).map((h: any) => ({ target: 7, log: {}, desc: '', icon: 'leaf', color: '#8B8CF8', createdAt: Date.now(), ...h })) : [],
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n: any) => n && n.id).map((n: any) => ({ title: '', body: '', tags: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now(), ...n })) : base.notes,
    folders: Array.isArray(raw.folders) ? raw.folders.filter((f: any) => f && f.id && f.name) : [],
    chat: Array.isArray(raw.chat) ? raw.chat.slice(-200) : [],
    settings: { ...base.settings, ...(raw.settings || {}) },
  };
}

export async function loadStore(): Promise<void> {
  try {
    const raw = await get(KEY);
    if (raw) state = sanitize(raw);
  } catch (e) {
    console.error('Lecture impossible', e);
  }
  loaded = true;
  emit();
}

export function isLoaded() {
  return loaded;
}

export function getState(): AppData {
  return state;
}

export function setState(updater: (s: AppData) => AppData) {
  state = updater(state);
  emit();
  scheduleSave();
}

export function useStore<T>(selector: (s: AppData) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

// ---------- Actions : habitudes ----------
export function upsertHabit(h: Habit) {
  setState((s) => {
    const exists = s.habits.some((x) => x.id === h.id);
    return { ...s, habits: exists ? s.habits.map((x) => (x.id === h.id ? h : x)) : [...s.habits, h] };
  });
}

export function deleteHabit(id: string) {
  setState((s) => ({
    ...s,
    habits: s.habits.filter((h) => h.id !== id),
    notes: s.notes.map((n) => (n.habitId === id ? { ...n, habitId: undefined } : n)),
  }));
}

export function toggleHabitDay(id: string, key: string) {
  setState((s) => ({
    ...s,
    habits: s.habits.map((h) => {
      if (h.id !== id) return h;
      const log = { ...h.log };
      if (log[key]) delete log[key];
      else log[key] = true;
      return { ...h, log };
    }),
  }));
}

// ---------- Actions : notes ----------
export function upsertNote(n: Note) {
  setState((s) => {
    const exists = s.notes.some((x) => x.id === n.id);
    return { ...s, notes: exists ? s.notes.map((x) => (x.id === n.id ? n : x)) : [n, ...s.notes] };
  });
}

export function deleteNote(id: string) {
  setState((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id), chat: s.chat.filter((m) => m.noteId !== id) }));
}

// ---------- Actions : dossiers ----------
const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Crée un dossier (ou renvoie celui qui porte déjà ce nom) et retourne son id. */
export function createFolder(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) return '';
  const existing = state.folders.find((f) => norm(f.name) === norm(clean));
  if (existing) return existing.id;
  const f: Folder = { id: uid(), name: clean, createdAt: Date.now() };
  setState((s) => ({ ...s, folders: [...s.folders, f] }));
  return f.id;
}

export function renameFolder(id: string, name: string) {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) return;
  setState((s) => ({ ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, name: clean } : f)) }));
}

/** Supprime le dossier ; ses notes sont gardées, sans dossier. */
export function deleteFolder(id: string) {
  setState((s) => ({
    ...s,
    folders: s.folders.filter((f) => f.id !== id),
    notes: s.notes.map((n) => (n.folderId === id ? { ...n, folderId: undefined } : n)),
  }));
}

export function moveNote(noteId: string, folderId?: string) {
  setState((s) => ({ ...s, notes: s.notes.map((n) => (n.id === noteId ? { ...n, folderId } : n)) }));
}

// ---------- Actions : chat ----------
export function pushChat(m: ChatMsg) {
  setState((s) => ({ ...s, chat: [...s.chat, m].slice(-200) }));
}

export function patchChat(id: string, patch: Partial<ChatMsg>) {
  setState((s) => ({ ...s, chat: s.chat.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
}

/** Efface une conversation : la générale (sans argument) ou celle d'une note. */
export function clearChat(noteId?: string) {
  setState((s) => ({ ...s, chat: s.chat.filter((m) => m.noteId !== noteId) }));
}

// ---------- Réglages ----------
export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}

// ---------- Sauvegarde ----------
export function exportJson(): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(text: string) {
  const parsed = JSON.parse(text);
  const data = sanitize(parsed);
  setState(() => data);
}
