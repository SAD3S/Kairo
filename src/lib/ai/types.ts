export type AiStatus = 'idle' | 'listen' | 'think' | 'data' | 'web' | 'vision' | 'format' | 'write';

export const STATUS_LABEL: Record<AiStatus, string> = {
  idle: 'En attente',
  listen: 'J’écoute…',
  think: 'Réfléchit…',
  data: 'Lit tes données',
  web: 'Cherche sur le web',
  vision: 'Regarde l’image',
  format: 'Remet en forme',
  write: 'Écrit…',
};

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Image en data URL (JPEG). */
  image?: string;
}

export interface ChatCallOpts {
  signal?: AbortSignal;
  onDelta: (text: string, kind: 'content' | 'thinking') => void;
  /** Statut pendant une étape préalable (ex. chargement du modèle). */
  onPrep?: (sub: string) => void;
}

export interface LlmBackend {
  chat(messages: LlmMessage[], opts: ChatCallOpts): Promise<string>;
  /** Budget de caractères pour le contexte (notes, habitudes). */
  contextBudget: number;
  label: string;
}

export class AiError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
  }
}
