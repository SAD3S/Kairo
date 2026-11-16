// Dictée vocale : plugin natif sur Android, Web Speech API sur ordinateur.
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

export interface Dictation {
  stop(): Promise<void>;
}

export async function startDictation(onText: (t: string) => void, onEnd: () => void): Promise<Dictation> {
  if (Capacitor.isNativePlatform()) {
    const { available } = await SpeechRecognition.available();
    if (!available) throw new Error('Reconnaissance vocale indisponible sur ce téléphone.');
    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== 'granted') throw new Error('Autorise le micro pour dicter.');
    const handles: PluginListenerHandle[] = [];
    handles.push(await SpeechRecognition.addListener('partialResults', (d) => d.matches?.[0] && onText(d.matches[0])));
    handles.push(
      await SpeechRecognition.addListener('listeningState', (d) => {
        if (d.status === 'stopped') {
          handles.forEach((h) => h.remove());
          onEnd();
        }
      }),
    );
    await SpeechRecognition.start({ language: 'fr-FR', partialResults: true, popup: false, maxResults: 1 });
    return { stop: () => SpeechRecognition.stop() };
  }

  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) throw new Error('Dictée non prise en charge par ce navigateur (essaie Chrome).');
  const rec = new Ctor();
  rec.lang = 'fr-FR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e: any) => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    onText(t);
  };
  rec.onend = onEnd;
  rec.onerror = onEnd;
  rec.start();
  return { stop: async () => rec.stop() };
}
