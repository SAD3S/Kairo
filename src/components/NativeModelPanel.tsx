import { useEffect, useState } from 'react';
import { formatBytes, LocalLlm, MODEL_BYTES, MODEL_LABEL, ModelStatus } from '../lib/ai/native';
import { Icon } from './Icon';
import { Loader } from './Loader';

/** Réglages de l'IA sur le téléphone (Android) : téléchargement et chargement du modèle. */
export function NativeModelPanel() {
  const [st, setSt] = useState<ModelStatus | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [mobileData, setMobileData] = useState(true);

  const refresh = () => LocalLlm.status().then(setSt).catch((e) => setErr(e?.message || String(e)));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (st?.error) setErr(st.error);
  }, [st?.error]);

  const enoughSpace = () => {
    if (st && st.freeBytes < MODEL_BYTES + 300e6) {
      setErr(`Pas assez d’espace libre : il faut ${formatBytes(MODEL_BYTES + 300e6)}, il reste ${formatBytes(st.freeBytes)}.`);
      return false;
    }
    return true;
  };

  const start = async () => {
    setErr('');
    if (!enoughSpace()) return;
    await LocalLlm.download({ allowMobileData: mobileData });
    refresh();
  };

  /** Téléchargement direct par l'app : passe outre les limites 4G d'Android, reprend après coupure. */
  const direct = async () => {
    setErr('');
    if (!enoughSpace()) return;
    await LocalLlm.downloadDirect();
    refresh();
  };

  const load = async () => {
    setErr('');
    setLoading(true);
    try {
      await LocalLlm.load();
    } catch (e: any) {
      setErr(e?.message || 'Chargement impossible');
    } finally {
      setLoading(false);
      refresh();
    }
  };

  if (!st) return <span className="muted">…</span>;
  const pct = st.total > 0 ? st.received / st.total : 0;
  const waitingWifi = st.state === 'paused' && (st.reason === 3 || !st.mobileData);
  const partial = st.state === 'missing' && st.received > 0;

  return (
    <>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
        L’IA tourne entièrement sur ton téléphone, même hors ligne. Modèle : <b>{MODEL_LABEL}</b> de Google (texte + images), {formatBytes(MODEL_BYTES)} à télécharger une seule fois.
      </p>

      {st.state === 'missing' && (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 14 }}>Utiliser la 4G / 5G</span>
              <span style={{ fontSize: 12, color: 'var(--dim)' }}>{mobileData ? `≈ ${formatBytes(MODEL_BYTES)} pris sur ton forfait` : 'Wi-Fi uniquement'}</span>
            </span>
            <button className={`switch ${mobileData ? 'on' : ''}`} role="switch" aria-checked={mobileData} aria-label="Utiliser les données mobiles" onClick={() => setMobileData((v) => !v)} />
          </div>
          {mobileData ? (
            <button className="btn primary" onClick={direct}><Icon name="download" size={16} />{partial ? 'Reprendre le téléchargement' : 'Télécharger le modèle'}</button>
          ) : (
            <button className="btn primary" onClick={start}><Icon name="download" size={16} />Télécharger en Wi-Fi</button>
          )}
          <span style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.45 }}>
            {mobileData ? 'Garde l’app ouverte pendant le téléchargement ; s’il coupe, il reprendra où il s’est arrêté. ' : 'Continue même si tu fermes l’app. '}
            Espace libre : {formatBytes(st.freeBytes)}
          </span>
        </>
      )}

      {(st.state === 'downloading' || st.state === 'paused') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <Loader status="data" />
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {st.state === 'paused' ? (waitingWifi ? 'En attente du Wi-Fi' : 'En pause') : `Téléchargement${st.mode === 'direct' ? ' (4G/Wi-Fi)' : ''}…`}
            </span>
            <span className="label" style={{ marginLeft: 'auto' }}>{Math.round(pct * 100)} %</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
            <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--a)', transition: 'width .4s' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>
            {formatBytes(st.received)} / {st.total > 0 ? formatBytes(st.total) : '…'}
            {st.mode === 'direct' ? ' · garde l’app ouverte' : ' · tu peux quitter l’app, ça continue'}
          </span>
          {st.mode === 'manager' && (
            <button className="btn small primary" onClick={direct}>Passer en 4G (téléchargement direct)</button>
          )}
          <button className="btn small" onClick={() => LocalLlm.cancelDownload().then(refresh)}>Annuler</button>
        </div>
      )}

      {st.state === 'ready' && (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14 }}>{MODEL_LABEL}</span>
            <span className="row" style={{ gap: 6 }}>
              <span className="tag">{formatBytes(st.size)}</span>
              <span className={`tag ${st.loaded ? 'accent' : ''}`}>{st.loaded ? `PRÊT · ${st.backend}` : 'INSTALLÉ'}</span>
            </span>
          </div>
          {!st.loaded && (
            <button className="btn" disabled={loading} onClick={load}>
              {loading ? <><Loader status="think" />Chargement… (jusqu’à 20 s)</> : <><Icon name="spark1" size={16} />Charger maintenant</>}
            </button>
          )}
          <button className="btn danger small" onClick={() => LocalLlm.deleteModel().then(refresh)}><Icon name="trash" size={14} />Supprimer le modèle</button>
        </>
      )}
      {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
    </>
  );
}
