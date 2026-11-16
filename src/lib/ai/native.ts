// Pont vers le plugin Android "LocalLlm" (Gemma 4 E2B via LiteRT-LM).
import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { AiError, ChatCallOpts, LlmBackend, LlmMessage } from './types';

export interface ModelStatus {
  state: 'ready' | 'missing' | 'downloading' | 'paused';
  received: number;
  total: number;
  size: number;
  loaded: boolean;
  backend: string;
  freeBytes: number;
  error?: string;
}

interface LocalLlmPlugin {
  status(): Promise<ModelStatus>;
  download(o: { allowMobileData?: boolean; url?: string }): Promise<{ state: string }>;
  cancelDownload(): Promise<void>;
  deleteModel(): Promise<void>;
  load(): Promise<{ backend: string }>;
  unload(): Promise<void>;
  generate(o: { id: string; system: string; history: { role: string; text: string }[]; text: string; image?: string }): Promise<{ text: string; cancelled: boolean; backend: string }>;
  cancel(): Promise<void>;
  addListener(event: 'token', cb: (d: { id: string; text: string }) => void): Promise<PluginListenerHandle>;
}

export const LocalLlm = registerPlugin<LocalLlmPlugin>('LocalLlm');

export const MODEL_LABEL = 'Gemma 4 E2B';
export const MODEL_BYTES = 2_588_147_712;

export const isNativeAndroid = () => Capacitor.getPlatform() === 'android';

let loaded = false;

/** Découpe la conversation pour le plugin : system, historique, dernier message. */
export function splitForNative(messages: LlmMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  const last = turns[turns.length - 1];
  const history = turns.slice(0, -1).map((m) => ({ role: m.role, text: m.content }));
  const image = last?.image ? last.image.slice(last.image.indexOf(',') + 1) : undefined;
  return { system, history, text: last?.content ?? '', image };
}

export function nativeBackend(): LlmBackend {
  return {
    label: `TÉLÉPHONE · ${MODEL_LABEL.toUpperCase()}`,
    contextBudget: 3500,
    async chat(messages: LlmMessage[], opts: ChatCallOpts) {
      const st = await LocalLlm.status();
      if (st.state !== 'ready') {
        throw new AiError('Le modèle n’est pas encore sur le téléphone.', st.state === 'downloading' ? 'Téléchargement en cours : patiente jusqu’à la fin (Réglages).' : 'Réglages → IA sur le téléphone → Télécharger le modèle.');
      }
      if (!st.loaded || !loaded) {
        opts.onPrep?.('chargement du modèle…');
        try {
          await LocalLlm.load();
          loaded = true;
        } catch (e: any) {
          throw new AiError('Impossible de charger le modèle sur ce téléphone.', e?.message);
        }
      }
      const id = Math.random().toString(36).slice(2);
      const handle = await LocalLlm.addListener('token', (d) => {
        if (d.id === id && !opts.signal?.aborted) opts.onDelta(d.text, 'content');
      });
      const onAbort = () => LocalLlm.cancel();
      opts.signal?.addEventListener('abort', onAbort);
      try {
        const r = await LocalLlm.generate({ id, ...splitForNative(messages) });
        if (opts.signal?.aborted || r.cancelled) throw new DOMException('Annulé', 'AbortError');
        return r.text;
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        throw new AiError('Le modèle local a rencontré une erreur.', e?.message);
      } finally {
        opts.signal?.removeEventListener('abort', onAbort);
        handle.remove();
      }
    },
  };
}

export function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2).replace('.', ',')} Go`;
  return `${Math.round(n / 1e6)} Mo`;
}
