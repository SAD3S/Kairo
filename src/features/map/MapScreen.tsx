import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from '../../components/BottomNav';
import { Icon } from '../../components/Icon';
import { Loader } from '../../components/Loader';
import { useNav } from '../../nav';
import { useStore } from '../../lib/store';
import { bearing, dist, LatLon } from './geo';
import { insidePack } from './pack';
import { installedManifest, isComplete, loadPackIndex, Manifest, OfflinePack, offlineStyle, packSupported } from './packStore';
import { MapError, Place } from './repo';
import { PlaceInput } from './PlaceInput';
import { T } from './strings';
import { Fix, lastKnownPosition, watchPosition } from './device';
import { MAP_STYLE, useMap } from './useMap';

const VIEW_KEY = 'kairo-map-view';
function savedView(): { center: [number, number]; zoom: number } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (v && Array.isArray(v.center)) return v;
  } catch { /* rien */ }
  return { center: [2.3488, 48.8534], zoom: 11 };
}

/** Vérifie d'abord sur le disque si le pack hors ligne est complet, puis affiche la carte. */
export function MapScreen() {
  const [checked, setChecked] = useState<{ pack: Manifest | null } | null>(packSupported() ? null : { pack: null });
  useEffect(() => {
    if (checked) return;
    OfflinePack.status({ id: 'idf' })
      .then((st) => { const m = installedManifest(); setChecked({ pack: isComplete(m, st) ? m : null }); })
      .catch(() => setChecked({ pack: null }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!checked) return <div className="screen" />;
  return <MapScreenInner pack={checked.pack} />;
}

function MapScreenInner({ pack }: { pack: Manifest | null }) {
  const nav = useNav();
  const box = useRef<HTMLDivElement>(null);
  const offlineMapPref = useStore((s) => s.settings.offlineMap);
  const mapStyle = useMemo(() => (pack && offlineMapPref ? offlineStyle(pack) : MAP_STYLE), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = useMemo(() => savedView(), []);
  const map = useMap(box, mapStyle, initial);

  const [place, setPlace] = useState<Place | null>(null);
  const [focus, setFocus] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [following, setFollowing] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState(false);

  const followingRef = useRef(false);
  const lastFix = useRef<Fix | null>(null);
  const heading = useRef(0);
  const stopWatch = useRef<(() => void) | null>(null);
  const firstFix = useRef(true);

  // Arrêt du GPS en quittant l'écran ; mémorise la dernière vue.
  useEffect(() => () => { stopWatch.current?.(); }, []);
  useEffect(() => {
    const m = map.map;
    if (!m) return;
    const save = () => {
      try { localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [m.getCenter().lng, m.getCenter().lat], zoom: m.getZoom() })); } catch { /* rien */ }
    };
    m.on('moveend', save);
    return () => { m.off('moveend', save); };
  }, [map.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Au premier affichage : centrer sur la dernière position connue, sans attendre un GPS précis.
  useEffect(() => {
    if (!map.ready || localStorage.getItem(VIEW_KEY)) return;
    lastKnownPosition().then((p) => { if (p) map.map?.jumpTo({ center: [p.lon, p.lat], zoom: 14 }); });
  }, [map.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geste à la main : on arrête de suivre (le bouton devient « Recentrer »).
  useEffect(() => {
    map.onUserGesture(() => { followingRef.current = false; setFollowing(false); });
  }, [map]);

  useEffect(() => { if (map.ready) map.setPlace(place); }, [place, map.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFix = (f: Fix) => {
    const prev = lastFix.current;
    // Cap de déplacement seulement quand on bouge vraiment (sinon le GPS fait tourner la carte au hasard).
    if (prev && dist(prev, f) > 4 && (f.speed ?? 1) > 0.8) heading.current = bearing(prev.lat, prev.lon, f.lat, f.lon);
    lastFix.current = f;
    setFix(f);
    setErr('');
    map.setUser(f, heading.current);
    if (followingRef.current) {
      const m = map.map;
      m?.easeTo({ center: [f.lon, f.lat], bearing: heading.current, zoom: firstFix.current ? Math.max(m.getZoom(), 16) : m.getZoom(), duration: firstFix.current ? 700 : 900 });
      firstFix.current = false;
    }
  };

  const recenter = () => {
    followingRef.current = true;
    setFollowing(true);
    const f = lastFix.current;
    if (f) map.map?.easeTo({ center: [f.lon, f.lat], bearing: heading.current, zoom: Math.max(map.map.getZoom(), 16), duration: 500 });
  };

  const locate = async () => {
    setErr('');
    if (tracking) return recenter();
    setStarting(true);
    try {
      firstFix.current = true;
      followingRef.current = true;
      setFollowing(true);
      stopWatch.current = await watchPosition(onFix, (m) => setErr(m));
      setTracking(true);
    } catch (e: any) {
      followingRef.current = false;
      setFollowing(false);
      setErr(e instanceof MapError ? e.message : T.gpsUnavailable);
    } finally {
      setStarting(false);
    }
  };

  const stopTracking = () => {
    stopWatch.current?.();
    stopWatch.current = null;
    followingRef.current = false;
    setTracking(false);
    setFollowing(false);
    setFix(null);
    lastFix.current = null;
    map.setUser(null);
    map.map?.easeTo({ bearing: 0, duration: 500 });
  };

  const pick = (p: Place) => {
    setPlace(p);
    setFocus(false);
    followingRef.current = false;
    setFollowing(false);
    map.map?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.map.getZoom(), 15), duration: 900 });
  };

  const bias = (): LatLon | null => lastFix.current ?? (map.map ? { lat: map.map.getCenter().lat, lon: map.map.getCenter().lng } : null);
  const offlineSearch = pack ? async (q: string, b: LatLon | null) => (await loadPackIndex(pack)).search(q, b) : undefined;
  const usingOffline = typeof mapStyle !== 'string';

  return (
    <div className={`screen${focus ? ' route-searching' : ''}`} style={{ background: usingOffline ? '#1c1c20' : '#e9e5dc' }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />

      <div className="glass route-top">
        <PlaceInput
          label={T.search}
          value={place}
          bias={bias}
          focused={focus}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onPick={pick}
          onClear={() => setPlace(null)}
          offline={offlineSearch}
          right={place ? (
            <button className="icon-btn ghost" aria-label={T.clearPlace} onClick={() => setPlace(null)}><Icon name="close" size={17} /></button>
          ) : null}
        />
      </div>

      {usingOffline && pack && insidePack({ lat: initial.center[1], lon: initial.center[0] }, pack.bbox) && (
        <span className="label glass map-badge">{T.offlineTag} · {pack.name.toUpperCase()}</span>
      )}
      {!pack && packSupported() && (
        <button className="tag glass map-badge" onClick={() => nav.go({ name: 'settings' })}>{T.packHint}</button>
      )}

      {/* Bouton position : démarre le GPS, puis « Recentrer » si la carte a été déplacée. */}
      {tracking && !following ? (
        <button className="icon-btn glass recenter rise" aria-label={T.recenter} onClick={recenter} style={{ bottom: `calc(var(--bottom) + ${place || fix || err ? 156 : 84}px)` }}>
          <Icon name="nav" size={20} />
          <span>{T.recenter}</span>
        </button>
      ) : (
        <button className="icon-btn glass locate-btn" aria-label={tracking ? T.follow : T.myPosition} aria-pressed={tracking} onClick={locate} style={tracking ? { color: 'var(--a)' } : undefined}>
          {starting ? <Loader status="think" /> : <Icon name={tracking ? 'nav' : 'locate'} size={20} />}
        </button>
      )}

      {(place || (tracking && fix) || err) && !focus && (
        <div className="glass route-panel rise" style={{ bottom: 'calc(var(--bottom) + 84px)', right: 76 }}>
          {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
          {place && (
            <div className="row" style={{ gap: 10 }}>
              <span style={{ color: 'var(--a)', display: 'flex' }}><Icon name="pin" size={18} /></span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</span>
                {place.context && <span style={{ fontSize: 12.5, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.context}</span>}
              </span>
            </div>
          )}
          {tracking && fix && !place && (
            <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{T.myPosition}</span>
                <span className="label" style={{ fontSize: 10 }}>{T.accuracy(Math.round(fix.accuracy))}{fix.speed && fix.speed > 0.8 ? ` · ${Math.round(fix.speed * 3.6)} km/h` : ''}</span>
              </span>
              <button className="btn small" onClick={stopTracking}>Arrêter</button>
            </div>
          )}
        </div>
      )}

      <BottomNav active="route" />
    </div>
  );
}
