export type HabitIcon = 'sport' | 'music' | 'book' | 'water' | 'sleep' | 'code' | 'heart' | 'leaf' | 'run' | 'pen';

export interface Habit {
  id: string;
  name: string;
  desc: string;
  color: string;
  icon: HabitIcon;
  /** Objectif : nombre de jours par semaine (1 à 7). */
  target: number;
  createdAt: number;
  /** Jours validés : clé "AAAA-MM-JJ" → true. */
  log: Record<string, true>;
}

export interface Note {
  id: string;
  title: string;
  /** Contenu : HTML riche si format = 'html', sinon Markdown. */
  body: string;
  format?: 'md' | 'html';
  tags: string[];
  pinned: boolean;
  habitId?: string;
  folderId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface Source {
  title: string;
  url: string;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Image jointe (data URL JPEG, réduite). */
  image?: string;
  sources?: Source[];
  /** Données de l'app consultées pour répondre (affichées en puces). */
  used?: string[];
  error?: boolean;
  /** Conversation rattachée à une note (absent = conversation générale). */
  noteId?: string;
  at: number;
}

export type Backend = 'ollama' | 'device';

export interface Settings {
  backend: Backend;
  ollamaUrl: string;
  ollamaModel: string;
  webEnabled: boolean;
  ollamaApiKey: string;
  /** Nom du fichier du modèle importé sur l'appareil. */
  deviceModelName: string;
  accent: string;
}

export interface AppData {
  version: 1;
  habits: Habit[];
  notes: Note[];
  folders: Folder[];
  chat: ChatMsg[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  backend: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'gemma4:e4b',
  webEnabled: true,
  ollamaApiKey: '',
  deviceModelName: '',
  accent: '#8B8CF8',
};
