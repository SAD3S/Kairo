import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Nav, NavCtx, Route } from './nav';
import { useStore } from './lib/store';
import { Home } from './screens/Home';
import { HabitDetail } from './screens/HabitDetail';
import { HabitForm } from './screens/HabitForm';
import { Chat } from './screens/Chat';
import { Camera } from './screens/Camera';
import { Notes } from './screens/Notes';
import { NoteEditor } from './screens/NoteEditor';
import { Settings } from './screens/Settings';

// La carte (MapLibre) est chargée seulement à l'ouverture de l'écran Itinéraire.
const RouteScreen = lazy(() => import('./features/route/RouteScreen').then((m) => ({ default: m.RouteScreen })));

export function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1];
  const accent = useStore((s) => s.settings.accent);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const go = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const tab = useCallback((r: Route) => setStack(r.name === 'home' ? [r] : [{ name: 'home' }, r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const nav: Nav = useMemo(() => ({ route, go, tab, back }), [route, go, tab, back]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    const h = CapApp.addListener('backButton', () => {
      if (stackRef.current.length > 1) back();
      else CapApp.minimizeApp();
    });
    return () => {
      h.then((x) => x.remove());
    };
  }, [back]);

  let screen: React.ReactElement;
  switch (route.name) {
    case 'habit': screen = <HabitDetail id={route.id} />; break;
    case 'habitForm': screen = <HabitForm id={route.id} />; break;
    case 'chat': screen = <Chat noteId={route.noteId} prefill={route.prefill} />; break;
    case 'camera': screen = <Camera />; break;
    case 'notes': screen = <Notes />; break;
    case 'note': screen = <NoteEditor id={route.id} />; break;
    case 'settings': screen = <Settings />; break;
    case 'route': screen = <Suspense fallback={<div className="screen" />}><RouteScreen /></Suspense>; break;
    default: screen = <Home />;
  }

  return (
    <NavCtx.Provider value={nav}>
      <div className="app" style={{ ['--a' as any]: accent }}>
        {screen}
      </div>
    </NavCtx.Provider>
  );
}
