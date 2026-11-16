import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Loader } from '../../components/Loader';
import { updateSettings, useStore } from '../../lib/store';
import { PACK_ID, PACK_NAME } from './pack';
import {
  fetchManifest, installedManifest, isComplete, Manifest, OfflinePack, packSupported, packTotal,
  PackStatus, resetPackCaches, saveInstalled, startDownload,
} from './packStore';

const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2).replace('.', ',')} Go` : `${Math.round(n / 1e6)} Mo`);
const FILE_LABEL: Record<string, string> = { 'graph.bin.gz': 'routes', 'places.json.gz': 'adresses', 'tiles.pmtiles': 'carte' };

/** Réglages → Cartes hors ligne : télécharger, mettre à jour ou supprimer le pack Île-de-France. */
export function OfflinePackPanel() {
  const offlineMap = useStore((s) => s.settings.offlineMap);
  const [remote, setRemote] = useState<Manifest | null>(null);
  const [remoteErr, setRemoteErr] = useState('');
  const [installed, setInstalled] = useState<Manifest | null>(() => installedManifest());
  const [st, setSt] = useState<PackStatus | null>(null);
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!packSupported()) return;
    fetchManifest().then(setRemote).catch((e) => setRemoteErr(e?.message || 'Pack indisponible (hors connexion ?)'));
    let alive = true;
    const tick = async () => {
      try {
        const s = await OfflinePack.status({ id: PACK_ID });
        if (!alive) return;
        setSt(s);
        if (s.error) setErr(s.error);
      } catch { /* plugin indisponible */ }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Téléchargement terminé : on enregistre la version installée.
  useEffect(() => {
    if (remote && st && !st.downloading && isComplete(remote, st) && installed?.version !== remote.version) {
      saveInstalled(remote);
      setInstalled(remote);
      resetPackCaches();
    }
  }, [remote, st, installed]);

  if (!packSupported()) {
    return <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Disponible dans l’app Android.</p>;
  }

  const target = remote ?? installed;
  const complete = isComplete(installed, st);
  const updateAvailable = complete && remote && installed && remote.version !== installed.version;
  const total = target ? packTotal(target) : 0;
  const pct = st && st.total > 0 ? Math.min(1, st.received / st.total) : 0;

  const download = async (m: Manifest, fresh = false) => {
    setErr('');
    if (st && st.freeBytes < packTotal(m) * 1.1 - (st.received || 0)) {
      setErr(`Pas assez d’espace : il faut ${fmt(packTotal(m) * 1.1)}, il reste ${fmt(st.freeBytes)}.`);
      return;
    }
    if (fresh) {
      await OfflinePack.remove({ id: PACK_ID });
      saveInstalled(null);
      setInstalled(null);
      resetPackCaches();
    }
    saveInstalled(m);
    setInstalled(m);
    await startDownload(m);
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{PACK_NAME}</span>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>Paris + 7 départements · carte, routes, adresses</span>
        </span>
        <span className={`tag ${complete ? 'accent' : ''}`}>{complete ? `INSTALLÉ · ${installed!.version}` : total ? fmt(total) : '…'}</span>
      </div>

      {st?.downloading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <Loader status="data" />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Téléchargement{st.current ? ` : ${FILE_LABEL[st.current] ?? st.current}` : ''}…</span>
            <span className="label" style={{ marginLeft: 'auto' }}>{Math.round(pct * 100)} %</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
            <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--a)', transition: 'width .4s' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>{fmt(st.received)} / {fmt(st.total)} · garde l’app ouverte ; si ça coupe, ça reprend où ça s’est arrêté.</span>
          <button className="btn small" onClick={() => OfflinePack.cancel()}>Mettre en pause</button>
        </div>
      ) : complete ? (
        <>
          {updateAvailable && (
            <button className="btn primary" onClick={() => download(remote!, true)}><Icon name="download" size={16} />Mettre à jour ({remote!.version})</button>
          )}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 14 }}>Carte hors ligne</span>
              <span style={{ fontSize: 12, color: 'var(--dim)' }}>{offlineMap ? 'Carte sombre du pack (Île-de-France)' : 'Carte en ligne (monde entier)'}</span>
            </span>
            <button className={`switch ${offlineMap ? 'on' : ''}`} role="switch" aria-checked={offlineMap} aria-label="Utiliser la carte hors ligne" onClick={() => updateSettings({ offlineMap: !offlineMap })} />
          </div>
          {confirmDel ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn small" style={{ flex: 1 }} onClick={() => setConfirmDel(false)}>Garder</button>
              <button className="btn small danger" style={{ flex: 1 }} onClick={async () => { await OfflinePack.remove({ id: PACK_ID }); saveInstalled(null); setInstalled(null); resetPackCaches(); setConfirmDel(false); }}>Supprimer</button>
            </div>
          ) : (
            <button className="btn small danger" onClick={() => setConfirmDel(true)}><Icon name="trash" size={14} />Supprimer le pack ({fmt(total)})</button>
          )}
        </>
      ) : remote ? (
        <>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
            Itinéraires instantanés et sans réseau dans toute l’Île-de-France, carte et recherche d’adresses (rues, communes, gares, lieux connus) hors ligne. Wi-Fi conseillé ; la 4G fonctionne aussi.
          </p>
          <button className="btn primary" onClick={() => download(remote)}>
            <Icon name="download" size={16} />{st && st.received > 0 ? 'Reprendre' : 'Télécharger'} ({fmt(total)})
          </button>
          {st && <span style={{ fontSize: 12, color: 'var(--dim)' }}>Espace libre : {fmt(st.freeBytes)} · version du {remote.version}</span>}
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: remoteErr ? 'var(--danger)' : 'var(--muted)' }}>{remoteErr || 'Recherche du pack…'}</p>
      )}
      {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
    </>
  );
}
