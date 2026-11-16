import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from '../../components/BottomNav';
import { Icon } from '../../components/Icon';
import { Loader } from '../../components/Loader';
import { bearing, dist, formatDistance, formatDuration, LatLon } from './geo';
import { maneuverText, ManeuverType, RoutePlan } from './instructions';
import { fetchRoads, Place, RouteError } from './repo';
import { OutsideError, sharedEngine } from './engine';
import type { GraphSlot } from './protocol';
import { insidePack } from './pack';
import { installedManifest, isComplete, loadPackGraph, loadPackIndex, Manifest, OfflinePack, offlineStyle, packSupported } from './packStore';
import { MAP_STYLE } from './useMap';
import { useStore } from '../../lib/store';
import { useNav } from '../../nav';
import { perfMark } from '../../lib/perf';
import { Algo } from './search';
import { T } from './strings';
import { NavTracker, NavUpdate } from './tracker';
import { currentPosition, keepScreenOn, speak, stopSpeaking, watchPosition } from './device';
import { useMap } from './useMap';
import { PlaceInput } from './PlaceInput';

const DURATIONS = [0, 2000, 5000, 10000, 20000];
type Phase = 'idle' | 'loading' | 'animating' | 'result' | 'nav';

function ArrowIcon({ type, size = 34 }: { type: ManeuverType | 'straight'; size?: number }) {
  const paths: Record<string, string> = {
    straight: 'M12 20V5M6 11l6-6 6 6',
    depart: 'M12 20V5M6 11l6-6 6 6',
    right: 'M7 20v-7a4 4 0 0 1 4-4h8M15 5l4 4-4 4',
    left: 'M17 20v-7a4 4 0 0 0-4-4H5M9 5L5 9l4 4',
    'slight-right': 'M9 20v-6l8-8M12 6h5v5',
    'slight-left': 'M15 20v-6L7 6M12 6H7v5',
    uturn: 'M16 20V9a4 4 0 0 0-8 0v6M4 12l4 4 4-4',
    arrive: 'M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[type] ?? paths.straight} />
    </svg>
  );
}

/** Vérifie d'abord sur le disque si le pack hors ligne est complet, puis affiche l'écran. */
export function RouteScreen() {
  const [checked, setChecked] = useState<{ pack: Manifest | null } | null>(packSupported() ? null : { pack: null });
  useEffect(() => {
    if (checked) return;
    OfflinePack.status({ id: 'idf' })
      .then((st) => { const m = installedManifest(); setChecked({ pack: isComplete(m, st) ? m : null }); })
      .catch(() => setChecked({ pack: null }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!checked) return <div className="screen" />;
  return <RouteScreenInner pack={checked.pack} />;
}

function RouteScreenInner({ pack }: { pack: Manifest | null }) {
  const mapBox = useRef<HTMLDivElement>(null);
  const [a, setA] = useState<Place | null>(null);
  const [b, setB] = useState<Place | null>(null);
  const [focus, setFocus] = useState<'A' | 'B' | null>(null);
  const [algo, setAlgo] = useState<Algo>('astar');
  const [speedIdx, setSpeedIdx] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<{ s: 'data' | 'think' | 'web'; label: string; sub?: string }>({ s: 'data', label: '' });
  const [err, setErr] = useState('');
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [stats, setStats] = useState<{ visited: number; algo: Algo; nodes: number } | null>(null);
  const [pressed, setPressed] = useState<LatLon | null>(null);
  const [locating, setLocating] = useState(false);
  const [nav, setNav] = useState<NavUpdate | null>(null);
  const [navMsg, setNavMsg] = useState('');
  const [rerouting, setRerouting] = useState(false);

  const engine = useMemo(() => sharedEngine(), []);
  const nav0 = useNav();
  const offlineMapPref = useStore((s) => s.settings.offlineMap);
  // Pack hors ligne : connu immédiatement (localStorage), vérifié ensuite sur le disque.
  const packChecked = true;
  const mapStyle = useMemo(() => (pack && offlineMapPref ? offlineStyle(pack) : MAP_STYLE), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [slotUsed, setSlotUsed] = useState<GraphSlot>('live');
  const graphKey = useRef('');
  const graphNodes = useRef(0);
  const packNodes = useRef(0);
  const lastFix = useRef<LatLon | null>(null);
  const abort = useRef<AbortController | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const tracker = useRef<NavTracker | null>(null);
  const planRef = useRef<RoutePlan | null>(null);
  const reroutingRef = useRef(false);
  const heading = useRef(0);

  const map = useMap(mapBox, mapStyle, (p) => { if (phase !== 'nav') setPressed(p); });


  const canUsePack = (p: LatLon, q: LatLon) => !!pack && insidePack(p, pack.bbox) && insidePack(q, pack.bbox);
  const offlineSearch = pack ? async (q: string, bias0: LatLon | null) => (await loadPackIndex(pack)).search(q, bias0) : undefined;

  useEffect(() => () => {
    abort.current?.abort();
    stopWatch.current?.();
    keepScreenOn(false);
    stopSpeaking();
  }, []);

  // Marqueurs A et B.
  useEffect(() => { if (map.ready) map.setPoint('A', a, !!a && !b); }, [a, map.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (map.ready) map.setPoint('B', b, !!b); }, [b, map.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetRoute = () => {
    map.clearExplored();
    map.setRoute(null);
    setPlan(null);
    setStats(null);
    if (phase === 'result') setPhase('idle');
  };

  const bias = () => lastFix.current ?? (map.map ? { lat: map.map.getCenter().lat, lon: map.map.getCenter().lng } : null);

  const useMyPosition = async () => {
    setErr('');
    setLocating(true);
    try {
      const f = await currentPosition();
      lastFix.current = f;
      setA({ id: 'gps', name: T.myPosition, context: 'GPS', lat: f.lat, lon: f.lon });
      resetRoute();
    } catch (e: any) {
      setErr(e instanceof RouteError ? e.message : T.gpsUnavailable);
    } finally {
      setLocating(false);
    }
  };

  const keyOf = (p: LatLon, q: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}|${q.lat.toFixed(4)},${q.lon.toFixed(4)}`;

  /** Prépare le graphe : celui du pack hors ligne si A et B y sont, sinon téléchargement Overpass. */
  const ensureGraph = async (from: LatLon, to: LatLon, signal: AbortSignal): Promise<GraphSlot> => {
    if (canUsePack(from, to) && pack) {
      if (!engine.ready.pack) {
        setStatus({ s: 'data', label: T.loadingPack, sub: 'une seule fois par session' });
        const t0 = performance.now();
        const buf = await loadPackGraph(pack, (r) => setStatus({ s: 'data', label: T.loadingPack, sub: `${Math.round(r * 100)} %` }));
        setStatus({ s: 'think', label: T.buildingGraph });
        const g = await engine.loadPackGraph(buf);
        packNodes.current = g.nodes;
        perfMark('graph.pack', performance.now() - t0, `${g.nodes.toLocaleString('fr-FR')} nœuds`);
      }
      return 'pack';
    }
    if (!navigator.onLine) throw new RouteError(T.offline);
    const key = keyOf(from, to);
    if (graphKey.current === key && engine.ready.live) return 'live';
    setStatus({ s: 'web', label: T.loadingGraph, sub: `${formatDistance(dist(from, to))} à vol d’oiseau` });
    const t0 = performance.now();
    const json = await fetchRoads(from, to, signal);
    const t1 = performance.now();
    perfMark('graph.download', t1 - t0, `${formatDistance(dist(from, to))}, ${(json.length / 1e6).toFixed(1)} Mo`);
    setStatus({ s: 'think', label: T.buildingGraph, sub: `${(json.length / 1e6).toFixed(1).replace('.', ',')} Mo` });
    const g = await engine.loadGraph(json);
    perfMark('graph.build', performance.now() - t1, `${g.nodes.toLocaleString('fr-FR')} nœuds`);
    graphKey.current = key;
    graphNodes.current = g.nodes;
    return 'live';
  };

  const compute = async () => {
    setErr('');
    setPressed(null);
    if (!a || !b) return setErr(T.needBoth);
    if (!navigator.onLine && !canUsePack(a, b)) return setErr(T.offline);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    map.clearExplored();
    map.setRoute(null);
    setPlan(null);
    setPhase('loading');
    try {
      const slot = await ensureGraph(a, b, ctrl.signal);
      setSlotUsed(slot);
      setPhase('animating');
      setStatus({ s: 'think', label: T.exploring, sub: algo === 'astar' ? 'A*' : 'Dijkstra' });
      map.fit([[a.lon, a.lat], [b.lon, b.lat]]);
      const r = await engine.run(algo, a, b, DURATIONS[speedIdx], slot, (lines) => map.addExplored(lines));
      map.clearExplored();
      map.setRoute(r.plan.coords);
      map.fit(r.plan.coords);
      setPlan(r.plan);
      planRef.current = r.plan;
      setStats({ visited: r.visited, algo, nodes: slot === 'pack' ? packNodes.current : graphNodes.current });
      setPhase('result');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setErr(e instanceof RouteError ? e.message : T.overpassError);
      setPhase('idle');
    }
  };

  // ------------------------------------------------------------ Navigation

  const reroute = async (from: LatLon) => {
    if (reroutingRef.current || !b) return;
    reroutingRef.current = true;
    setRerouting(true);
    try {
      let r;
      const ctrl = new AbortController();
      abort.current = ctrl;
      let slot = canUsePack(from, b) ? await ensureGraph(from, b, ctrl.signal) : slotUsed;
      try {
        r = await engine.run(algo, from, b, 0, slot);
      } catch (e) {
        if (!(e instanceof OutsideError)) throw e;
        // Hors de la zone chargée : on recharge les routes depuis la position actuelle.
        graphKey.current = '';
        slot = await ensureGraph(from, b, ctrl.signal);
        r = await engine.run(algo, from, b, 0, slot);
      }
      planRef.current = r.plan;
      setPlan(r.plan);
      tracker.current = new NavTracker(r.plan);
      map.setRoute(r.plan.coords);
    } catch (e: any) {
      setNavMsg(e instanceof RouteError ? e.message : T.overpassError);
    } finally {
      reroutingRef.current = false;
      setRerouting(false);
    }
  };

  const onFix = (f: { lat: number; lon: number }) => {
    const t = tracker.current;
    if (!t) return;
    const u = t.update(f, Date.now());
    const prev = lastFix.current;
    if (prev && dist(prev, f) > 3) heading.current = bearing(prev.lat, prev.lon, f.lat, f.lon);
    else if (!prev) heading.current = u.routeBearing;
    lastFix.current = f;
    setNavMsg('');
    setNav(u);
    map.setUser(f, heading.current);
    map.map?.easeTo({ center: [f.lon, f.lat], bearing: heading.current, pitch: 50, zoom: 17, duration: 900 });
    if (u.speak) speak(u.speak);
    if (u.reroute) reroute(f);
  };

  const startNav = async () => {
    if (!planRef.current) return;
    setErr('');
    setNav(null);
    setNavMsg(T.gpsWaiting);
    try {
      tracker.current = new NavTracker(planRef.current);
      lastFix.current = null;
      stopWatch.current = await watchPosition(onFix, (m) => setNavMsg(m));
      await keepScreenOn(true);
      setPhase('nav');
    } catch (e: any) {
      setErr(e instanceof RouteError ? e.message : T.gpsUnavailable);
      setNavMsg('');
    }
  };

  const stopNav = () => {
    stopWatch.current?.();
    stopWatch.current = null;
    tracker.current = null;
    keepScreenOn(false);
    stopSpeaking();
    map.setUser(null);
    map.map?.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    setNav(null);
    setPhase('result');
  };

  const etaClock = (sec: number) => {
    const d = new Date(Date.now() + sec * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const busy = phase === 'loading' || phase === 'animating';
  const navRemainingTime = nav && plan ? plan.time * (nav.remaining / Math.max(1, plan.distance)) : 0;

  return (
    <div className="screen" style={{ background: '#e9e5dc' }}>
      <div ref={mapBox} style={{ position: 'absolute', inset: 0 }} />

      {phase !== 'nav' ? (
        <>
          {/* Saisie A / B */}
          <div className="glass route-top">
            <PlaceInput
              label={T.from}
              dot="A"
              value={a}
              bias={bias}
              focused={focus === 'A'}
              onFocus={() => setFocus('A')}
              onBlur={() => setFocus((f) => (f === 'A' ? null : f))}
              onPick={(p) => { setA(p); resetRoute(); setFocus(null); }}
              onClear={() => { setA(null); resetRoute(); }}
              offline={offlineSearch}
              right={
                <button className="icon-btn ghost" aria-label={T.myPosition} disabled={locating} onClick={useMyPosition} style={{ color: 'var(--a)' }}>
                  {locating ? <Loader status="think" /> : <Icon name="locate" size={19} />}
                </button>
              }
            />
            <div style={{ height: 1, background: 'var(--line)', marginLeft: 36 }} />
            <PlaceInput
              label={T.to}
              dot="B"
              value={b}
              bias={bias}
              focused={focus === 'B'}
              onFocus={() => setFocus('B')}
              onBlur={() => setFocus((f) => (f === 'B' ? null : f))}
              onPick={(p) => { setB(p); resetRoute(); setFocus(null); }}
              onClear={() => { setB(null); resetRoute(); }}
              offline={offlineSearch}
              right={
                <button className="icon-btn ghost" aria-label={T.swap} onClick={() => { const x = a; setA(b); setB(x); resetRoute(); }}>
                  <Icon name="swap" size={19} />
                </button>
              }
            />
          </div>

          {/* Appui long : A ou B */}
          {pressed && !busy && (
            <div className="glass route-panel rise" role="dialog" aria-label={T.pinnedPoint} style={{ bottom: 'calc(var(--bottom) + 84px)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>{T.pinnedPoint}</span>
                <button className="icon-btn ghost" aria-label="Fermer" onClick={() => setPressed(null)}><Icon name="close" size={16} /></button>
              </div>
              <span className="label" style={{ fontSize: 10 }}>{pressed.lat.toFixed(5)}, {pressed.lon.toFixed(5)}</span>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => { setA({ id: 'pin-a', name: T.pinnedPoint, context: `${pressed.lat.toFixed(4)}, ${pressed.lon.toFixed(4)}`, ...pressed }); setPressed(null); resetRoute(); }}>{T.setAsFrom}</button>
                <button className="btn primary" style={{ flex: 1 }} onClick={() => { setB({ id: 'pin-b', name: T.pinnedPoint, context: `${pressed.lat.toFixed(4)}, ${pressed.lon.toFixed(4)}`, ...pressed }); setPressed(null); resetRoute(); }}>{T.setAsTo}</button>
              </div>
            </div>
          )}

          {/* Panneau de calcul */}
          {!pressed && (
            <div className="glass route-panel" style={{ bottom: 'calc(var(--bottom) + 84px)' }}>
              {busy ? (
                <>
                  <div className="row" style={{ gap: 12 }} role="status" aria-live="polite">
                    <Loader status={status.s} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                      <span style={{ fontWeight: 600 }}>{status.label}…</span>
                      {status.sub && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#9a9aa3' }}>{status.sub}</span>}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn" style={{ flex: 1 }} onClick={() => { abort.current?.abort(); engine.skip(); if (phase === 'loading') setPhase('idle'); }}>{phase === 'animating' ? T.skip : 'Annuler'}</button>
                  </div>
                </>
              ) : phase === 'result' && plan ? (
                <>
                  <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>{formatDuration(plan.time)}</span>
                    <span style={{ fontSize: 16, color: 'var(--muted)' }}>{formatDistance(plan.distance)}</span>
                  </div>
                  {stats && <span className="label" style={{ fontSize: 10 }}>{slotUsed === 'pack' ? `${T.offlineTag} · ` : ''}{stats.algo === 'astar' ? 'A*' : 'Dijkstra'} · {T.visited(stats.visited)} / {stats.nodes.toLocaleString('fr-FR')}</span>}
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn" onClick={() => { resetRoute(); setPhase('idle'); }} aria-label="Modifier"><Icon name="back" size={16} /></button>
                    <button className="btn" style={{ flex: 1 }} onClick={() => { setAlgo(algo === 'astar' ? 'dijkstra' : 'astar'); setPhase('idle'); map.setRoute(null); }}>Comparer avec {algo === 'astar' ? 'Dijkstra' : 'A*'}</button>
                    <button className="btn primary" style={{ flex: 1.2 }} onClick={startNav}><Icon name="nav" size={16} />{T.start}</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="seg" role="radiogroup" aria-label={T.algo}>
                    <button role="radio" aria-checked={algo === 'dijkstra'} className={algo === 'dijkstra' ? 'on' : ''} onClick={() => setAlgo('dijkstra')}>{T.dijkstra}</button>
                    <button role="radio" aria-checked={algo === 'astar'} className={algo === 'astar' ? 'on' : ''} onClick={() => setAlgo('astar')}>{T.astar}</button>
                  </div>
                  <label className="field" style={{ gap: 4 }}>
                    <span className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="label" style={{ fontSize: 10 }}>{T.speed}</span>
                      <span className="label" style={{ fontSize: 10, color: 'var(--a-soft)' }}>{T.speedLabels[speedIdx]}</span>
                    </span>
                    <input type="range" min={0} max={4} step={1} value={speedIdx} onChange={(e) => setSpeedIdx(+e.target.value)} className="range" aria-label={T.speed} />
                  </label>
                  <button className="btn primary" onClick={compute} disabled={!a || !b}><Icon name="route" size={16} />{T.compute}</button>
                  {pack ? (
                    <span className="label" style={{ fontSize: 10, textAlign: 'center', color: 'var(--a-soft)' }}>{T.offlineTag} · {pack.name.toUpperCase()} · {pack.version}</span>
                  ) : packSupported() && packChecked ? (
                    <button className="tag" style={{ alignSelf: 'center', padding: '6px 10px' }} onClick={() => nav0.go({ name: 'settings' })}>{T.packHint}</button>
                  ) : null}
                </>
              )}
              {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
            </div>
          )}
          <BottomNav active="route" />
        </>
      ) : (
        <>
          {/* Bandeau de guidage */}
          <div className="nav-banner" role="status" aria-live="polite">
            {nav?.next ? (
              <>
                <span style={{ color: 'var(--bg)' }}><ArrowIcon type={nav.arrived ? 'arrive' : nav.next.type} /></span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>{nav.arrived ? T.arrived : formatDistance(nav.distToNext)}</span>
                  {!nav.arrived && <span style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{maneuverText(nav.next)}</span>}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 16, fontWeight: 600 }}>{navMsg || T.gpsWaiting}</span>
            )}
          </div>
          {(rerouting || (navMsg && nav)) && (
            <div className="glass nav-toast">
              {rerouting ? <><Loader status="think" />{T.recalculating}</> : navMsg}
            </div>
          )}
          <div className="glass route-panel" style={{ bottom: 'calc(var(--bottom) + 16px)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{nav ? formatDuration(navRemainingTime) : '—'}</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{nav ? `${formatDistance(nav.remaining)} · ${T.arrivalAt} ${etaClock(navRemainingTime)}` : ''}</span>
              </span>
              <button className="btn danger" onClick={stopNav}><Icon name="close" size={16} />{T.stop}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );

}
