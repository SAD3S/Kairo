// GPS de l'appareil (FusedLocationProviderClient sur Android, via Capacitor).
import { Capacitor } from '@capacitor/core';
import { Geolocation, Position } from '@capacitor/geolocation';
import { LatLon } from './geo';
import { MapError } from './repo';
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
  if (st.location !== 'granted') throw new MapError(T.gpsDenied);
}

/** Dernière position connue (rapide, peu précise) : pour centrer la carte tout de suite. */
export async function lastKnownPosition(): Promise<Fix | null> {
  try {
    if (Capacitor.isNativePlatform() && (await Geolocation.checkPermissions()).location !== 'granted') return null;
    return toFix(await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 3000, maximumAge: 600000 }));
  } catch {
    return null;
  }
}

export async function currentPosition(): Promise<Fix> {
  await ensureLocationPermission();
  try {
    return toFix(await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }));
  } catch (e: any) {
    if (/denied|permission/i.test(e?.message ?? '')) throw new MapError(T.gpsDenied);
    throw new MapError(T.gpsUnavailable);
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
