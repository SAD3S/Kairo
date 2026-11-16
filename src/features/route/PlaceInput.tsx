import { useEffect, useRef, useState } from 'react';
import { LatLon } from './geo';
import { Place, photonSearch, RouteError } from './repo';
import { T } from './strings';

/** Champ d'adresse avec suggestions Photon : debounce 300 ms, ≥ 3 caractères, requête précédente annulée. */
export function PlaceInput({
  label,
  dot,
  value,
  bias,
  onPick,
  onClear,
  right,
  focused,
  onFocus,
  onBlur,
  offline,
}: {
  label: string;
  dot: 'A' | 'B';
  value: Place | null;
  bias: () => LatLon | null;
  onPick: (p: Place) => void;
  onClear: () => void;
  right?: React.ReactNode;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  /** Recherche dans l'index hors ligne (si le pack est installé). */
  offline?: (q: string, bias: LatLon | null) => Promise<Place[]>;
}) {
  const [text, setText] = useState(value?.name ?? '');
  const [items, setItems] = useState<Place[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const [err, setErr] = useState('');
  const edited = useRef(false);

  // Synchronise le texte quand la valeur change de l'extérieur (GPS, appui long, inversion).
  useEffect(() => {
    edited.current = false;
    setText(value?.name ?? '');
    setItems([]);
    setState('idle');
  }, [value]);

  useEffect(() => {
    if (!edited.current) return;
    const q = text.trim();
    if (q.length < 3) {
      setItems([]);
      setState('idle');
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setState('loading');
      const local = async () => (offline ? offline(q, bias()) : []);
      try {
        // Hors connexion : directement l'index du pack. Sinon Photon, avec l'index en secours.
        let r = navigator.onLine ? await photonSearch(q, bias(), ctrl.signal) : await local();
        if (!r.length && navigator.onLine) r = await local();
        if (ctrl.signal.aborted) return;
        setItems(r);
        setState(r.length ? 'idle' : 'empty');
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        try {
          const r = await local();
          if (r.length) { setItems(r); setState('idle'); return; }
        } catch { /* index indisponible */ }
        setErr(e instanceof RouteError ? e.message : T.photonError);
        setState('error');
      }
    }, 300);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = focused && (items.length > 0 || state !== 'idle');

  return (
    <div style={{ position: 'relative' }}>
      <div className="row" style={{ gap: 10, height: 46 }}>
        <span className={`pin-dot pin-dot-${dot}`} aria-hidden="true">{dot}</span>
        <input
          className="route-input"
          aria-label={label}
          placeholder={label}
          value={text}
          autoComplete="off"
          onFocus={(e) => { onFocus(); e.currentTarget.select(); }}
          onBlur={() => window.setTimeout(onBlur, 150)}
          onChange={(e) => { edited.current = true; setText(e.target.value); if (!e.target.value) onClear(); }}
        />
        {right}
      </div>
      {open && (
        <div className="suggest glass rise" role="listbox" aria-label={`Suggestions pour ${label}`}>
          {state === 'loading' && !items.length && <div className="suggest-msg">{T.searching}</div>}
          {state === 'empty' && <div className="suggest-msg">{T.noResult}</div>}
          {state === 'error' && <div className="suggest-msg err">{err}</div>}
          {items.map((p) => (
            <button
              key={p.id + p.lat}
              role="option"
              aria-selected={false}
              className="suggest-item"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => { edited.current = false; onPick(p); setItems([]); }}
            >
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{p.name}</span>
              {p.context && <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>{p.context}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
