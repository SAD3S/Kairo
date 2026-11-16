// IA "sur le téléphone" : MediaPipe LLM Inference (WebGPU) + un modèle Gemma
// au format .litertlm "-Web" importé par l'utilisateur. Expérimental.
import type { LlmInference, Prompt } from '@mediapipe/tasks-genai';
import { AiError, ChatCallOpts, LlmBackend, LlmMessage } from './types';

const FILE_NAME = 'model.litertlm';

let llm: LlmInference | null = null;
let loadingPromise: Promise<LlmInference> | null = null;
let visionEnabled = false;

export async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as any).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function dir() {
  if (!navigator.storage?.getDirectory) throw new AiError('Stockage de fichiers indisponible sur cet appareil.');
  return navigator.storage.getDirectory();
}

export async function getModelFile(): Promise<File | null> {
  try {
    const d = await dir();
    const h = await d.getFileHandle(FILE_NAME);
    return await h.getFile();
  } catch {
    return null;
  }
}

/** Copie le fichier choisi dans le stockage privé de l'app (avec progression). */
export async function importModelFile(file: File, onProgress: (ratio: number) => void): Promise<void> {
  await unloadModel();
  const d = await dir();
  const h = await d.getFileHandle(FILE_NAME, { create: true });
  const w = await (h as any).createWritable();
  let written = 0;
  const progress = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      written += chunk.byteLength;
      onProgress(written / file.size);
      ctrl.enqueue(chunk);
    },
  });
  await file.stream().pipeThrough(progress).pipeTo(w);
}

export async function deleteModelFile(): Promise<void> {
  await unloadModel();
  try {
    const d = await dir();
    await d.removeEntry(FILE_NAME);
  } catch {
    /* rien à supprimer */
  }
}

export async function unloadModel() {
  try {
    llm?.close();
  } catch {
    /* ignore */
  }
  llm = null;
  loadingPromise = null;
}

async function create(file: File, withVision: boolean): Promise<LlmInference> {
  const { FilesetResolver, LlmInference } = await import('@mediapipe/tasks-genai');
  const wasmBase = new URL('./genai-wasm', document.baseURI).href;
  const fileset = await FilesetResolver.forGenAiTasks(wasmBase);
  return LlmInference.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: file.stream().getReader() as any },
    maxTokens: 4096,
    topK: 40,
    temperature: 0.7,
    randomSeed: Math.floor(Math.random() * 1e6),
    ...(withVision ? { maxNumImages: 1 } : {}),
  });
}

async function ensureLoaded(): Promise<LlmInference> {
  if (llm) return llm;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    if (!(await hasWebGpu())) {
      throw new AiError("Ce téléphone n'expose pas WebGPU à l'app.", "Utilise plutôt le mode « Mon ordi (Ollama) » dans les réglages.");
    }
    const file = await getModelFile();
    if (!file) throw new AiError("Aucun modèle importé sur le téléphone.", 'Réglages → IA sur le téléphone → Importer un modèle.');
    try {
      llm = await create(file, true);
      visionEnabled = true;
    } catch {
      // Modèle sans vision : on recharge en mode texte seul.
      llm = await create(file, false);
      visionEnabled = false;
    }
    return llm;
  })();
  try {
    return await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    throw e;
  }
}

/** Construit le prompt au format de conversation Gemma. */
export function gemmaPrompt(messages: LlmMessage[], allowImage: boolean): Prompt {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  const parts: (string | { imageSource: string })[] = [];
  let firstUser = true;
  turns.forEach((m, i) => {
    if (m.role === 'user') {
      let text = m.content;
      if (firstUser && system) text = `${system}\n\n${text}`;
      firstUser = false;
      parts.push('<start_of_turn>user\n');
      if (m.image && allowImage && i === turns.length - 1) parts.push({ imageSource: m.image });
      parts.push(`${text}<end_of_turn>\n`);
    } else {
      parts.push(`<start_of_turn>model\n${m.content}<end_of_turn>\n`);
    }
  });
  parts.push('<start_of_turn>model\n');
  return parts as Prompt;
}

export function deviceBackend(): LlmBackend {
  return {
    label: 'TÉLÉPHONE · GEMMA',
    contextBudget: 3000,
    async chat(messages: LlmMessage[], opts: ChatCallOpts) {
      if (!llm) opts.onPrep?.('chargement du modèle…');
      const model = await ensureLoaded();
      const hasImage = messages.some((m) => m.image);
      if (hasImage && !visionEnabled) {
        throw new AiError("Le modèle importé ne lit pas les images.", 'Importe une version Gemma 3n ou Gemma 4 « -Web » avec vision, ou utilise Ollama.');
      }
      const onAbort = () => model.cancelProcessing();
      opts.signal?.addEventListener('abort', onAbort);
      let out = '';
      try {
        await model.generateResponse(gemmaPrompt(messages, visionEnabled), (partial: string) => {
          if (opts.signal?.aborted) return;
          out += partial;
          opts.onDelta(partial, 'content');
        });
      } finally {
        opts.signal?.removeEventListener('abort', onAbort);
      }
      if (opts.signal?.aborted) throw new DOMException('Annulé', 'AbortError');
      return out.replace(/<end_of_turn>[\s\S]*$/, '');
    },
  };
}
