import { AiError, ChatCallOpts, LlmBackend, LlmMessage } from './types';
import { Settings } from '../types';

function base(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function networkError(url: string) {
  return new AiError(
    `Impossible de joindre Ollama (${url}).`,
    "Vérifie qu'Ollama est lancé sur ton Mac. Depuis le téléphone : même Wi-Fi, adresse IP du Mac dans les réglages, et Ollama démarré avec OLLAMA_HOST=0.0.0.0 (voir le guide).",
  );
}

export async function listOllamaModels(url: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${base(url)}/api/tags`);
  } catch {
    throw networkError(url);
  }
  if (!res.ok) throw new AiError(`Ollama a répondu ${res.status}.`);
  const json = await res.json();
  return (json.models || []).map((m: any) => m.name as string);
}

/** Lit un flux NDJSON (une ligne JSON par morceau) et appelle `onLine`. */
export async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (obj: any) => void) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
  if (buf.trim()) onLine(JSON.parse(buf.trim()));
}

export function toOllamaMessages(messages: LlmMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.image ? { images: [m.image.slice(m.image.indexOf(',') + 1)] } : {}),
  }));
}

export function ollamaBackend(s: Settings): LlmBackend {
  const url = base(s.ollamaUrl);
  return {
    label: `LOCAL · ${s.ollamaModel.toUpperCase()}`,
    contextBudget: 9000,
    async chat(messages: LlmMessage[], opts: ChatCallOpts) {
      let res: Response;
      try {
        res = await fetch(`${url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: opts.signal,
          body: JSON.stringify({
            model: s.ollamaModel,
            messages: toOllamaMessages(messages),
            stream: true,
            options: { num_ctx: 8192, temperature: 0.6 },
          }),
        });
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        throw networkError(url);
      }
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '');
        if (res.status === 404 || /not found/i.test(txt)) {
          throw new AiError(`Le modèle « ${s.ollamaModel} » n'est pas installé.`, `Sur ton Mac, lance : ollama pull ${s.ollamaModel}`);
        }
        throw new AiError(`Ollama a répondu ${res.status}.`, txt.slice(0, 200));
      }
      let out = '';
      await readNdjson(res.body, (obj) => {
        if (obj.error) throw new AiError(String(obj.error));
        const m = obj.message || {};
        if (m.thinking) opts.onDelta(m.thinking, 'thinking');
        if (m.content) {
          out += m.content;
          opts.onDelta(m.content, 'content');
        }
      });
      return out;
    },
  };
}
