// État global d'une conversation en cours : survit aux changements d'écran.
import { useSyncExternalStore } from 'react';
import { getState, patchChat, pushChat, uid } from '../store';
import { runAgent } from './agent';
import { AiError, AiStatus } from './types';

interface SessionState {
  busy: boolean;
  status: AiStatus;
  sub?: string;
  draft: string;
}

let st: SessionState = { busy: false, status: 'idle', draft: '' };
let controller: AbortController | null = null;
const ls = new Set<() => void>();
const set = (p: Partial<SessionState>) => {
  st = { ...st, ...p };
  ls.forEach((l) => l());
};

export function useSession(): SessionState {
  return useSyncExternalStore(
    (cb) => {
      ls.add(cb);
      return () => ls.delete(cb);
    },
    () => st,
  );
}

export function setListening(on: boolean) {
  if (st.busy) return;
  set({ status: on ? 'listen' : 'idle', sub: on ? 'transcription en direct' : undefined });
}

export function errorText(e: any): string {
  if (e instanceof AiError) return `**${e.message}**${e.hint ? `\n\n${e.hint}` : ''}`;
  return `**Erreur :** ${e?.message || String(e)}`;
}

export async function sendChat(text: string, image?: string, focusNoteId?: string) {
  if (st.busy) return;
  const data = getState();
  const history = data.chat;
  pushChat({ id: uid(), role: 'user', text, image, at: Date.now() });
  controller = new AbortController();
  set({ busy: true, status: 'think', sub: undefined, draft: '' });
  const id = uid();
  try {
    const r = await runAgent({
      data,
      history,
      text,
      image,
      focusNoteId,
      signal: controller.signal,
      onStatus: (status, sub) => set({ status, sub }),
      onText: (draft) => set({ draft }),
    });
    pushChat({ id, role: 'assistant', text: r.text || '…', sources: r.sources, used: r.used, at: Date.now() });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      if (st.draft) pushChat({ id, role: 'assistant', text: st.draft + ' …', at: Date.now() });
    } else {
      pushChat({ id, role: 'assistant', text: errorText(e), error: true, at: Date.now() });
    }
  } finally {
    controller = null;
    set({ busy: false, status: 'idle', sub: undefined, draft: '' });
  }
}

export function stopChat() {
  controller?.abort();
}

export { patchChat };
