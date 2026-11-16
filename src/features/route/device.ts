// Services de l'appareil pour la navigation : GPS, voix, écran allumé.
import { Capacitor } from '@capacitor/core';
import { Geolocation, Position } from '@capacitor/geolocation';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { LatLon } from './geo';
import { RouteError } from './repo';
import { T } from './strings';

export interface Fix extends LatLon {
  accuracy: number;
  speed: number | null;
  time: number;
}

const toFix = (p: Position): Fix => ({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, time: p.timestamp });

/** Demande la permission de localisation précise ; lève une erreur claire en cas de refus. */
export async function ensureLocationPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return; // le navigateur demande lui-même
  let st = await Geolocation.checkPermissions();
  if (st.location !== 'granted') st = await Geolocation.requestPermissions({ permissions: ['location'] });
  if (st.location !== 'granted') throw new RouteError(T.gpsDenied);
}

export async function currentPosition(): Promise<Fix> {
  await ensureLocationPermission();
  try {
    return toFix(await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }));
  } catch (e: any) {
    if (/denied|permission/i.test(e?.message ?? '')) throw new RouteError(T.gpsDenied);
    throw new RouteError(T.gpsUnavailable);
  }
}

/** Suivi continu de la position (FusedLocationProviderClient sur Android). Renvoie une fonction d'arrêt. */
export async function watchPosition(onFix: (f: Fix) => void, onError: (msg: string) => void): Promise<() => void> {
  await ensureLocationPermission();
  const id = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }, (p, err) => {
    if (err) onError(/denied|permission/i.test(err.message ?? '') ? T.gpsDenied : T.gpsUnavailable);
    else if (p) onFix(toFix(p));
  });
  return () => { Geolocation.clearWatch({ id }); };
}

let speaking = Promise.resolve();
export function speak(text: string) {
  // File d'attente simple : une annonce à la fois.
  speaking = speaking
    .then(() => TextToSpeech.speak({ text, lang: 'fr-FR', rate: 1.0, pitch: 1.0, volume: 1.0, category: 'playback' }))
    .catch(() => {});
}

export async function stopSpeaking() {
  try { await TextToSpeech.stop(); } catch { /* rien */ }
}

export async function keepScreenOn(on: boolean) {
  try { await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()); } catch { /* non disponible */ }
}
