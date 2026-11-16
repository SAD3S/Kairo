// Copie les fichiers WebAssembly de MediaPipe dans public/ pour que l'IA
// "sur le téléphone" fonctionne hors ligne (sans CDN).
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const src = 'node_modules/@mediapipe/tasks-genai/wasm';
const dst = 'public/genai-wasm';
if (!existsSync(src)) process.exit(0);
mkdirSync(dst, { recursive: true });
for (const f of ['genai_wasm_internal.js', 'genai_wasm_internal.wasm', 'genai_wasm_nosimd_internal.js', 'genai_wasm_nosimd_internal.wasm']) {
  cpSync(`${src}/${f}`, `${dst}/${f}`);
}
console.log('MediaPipe wasm copié dans public/genai-wasm');
