import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Icon } from '../components/Icon';
import { useNav } from '../nav';
import { exportJson, importJson, updateSettings, useStore } from '../lib/store';
import { listOllamaModels } from '../lib/ai/ollama';
import { deleteModelFile, getModelFile, hasWebGpu, importModelFile } from '../lib/ai/device';
import { webSearch } from '../lib/ai/web';
import { AiError } from '../lib/ai/types';

const ACCENTS = ['#8B8CF8', '#6FCFE0', '#E9A15B', '#7BD88F', '#E58FD0'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span className="label" style={{ padding: '8px 4px 0' }}>{title}</span>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </section>
  );
}

const msg = (e: any) => (e instanceof AiError ? `${e.message}${e.hint ? ' ' + e.hint : ''}` : e?.message || String(e));

export function Settings() {
  const nav = useNav();
  const s = useStore((x) => x.settings);
  const [models, setModels] = useState<string[] | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [webTest, setWebTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [gpu, setGpu] = useState<boolean | null>(null);
  const [devFile, setDevFile] = useState<File | null>(null);
  const [importing, setImporting] = useState<number | null>(null);
  const [devErr, setDevErr] = useState('');
  const [dataMsg, setDataMsg] = useState('');
  const modelInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (s.backend !== 'device') return;
    hasWebGpu().then(setGpu);
    getModelFile().then(setDevFile);
  }, [s.backend]);

  const testOllama = async () => {
    setTest(null);
    try {
      const m = await listOllamaModels(s.ollamaUrl);
      setModels(m);
      const has = m.includes(s.ollamaModel) || m.includes(`${s.ollamaModel}:latest`);
      setTest({ ok: has, text: has ? `Connecté. ${m.length} modèle(s) installé(s).` : `Connecté, mais « ${s.ollamaModel} » n’est pas installé. Choisis un modèle ci-dessous ou lance : ollama pull ${s.ollamaModel}` });
    } catch (e) {
      setModels(null);
      setTest({ ok: false, text: msg(e) });
    }
  };

  const testWeb = async () => {
    setWebTest(null);
    try {
      const r = await webSearch('météo Paris', s.ollamaApiKey, 1);
      setWebTest({ ok: true, text: `Recherche web OK (${r.length} résultat).` });
    } catch (e) {
      setWebTest({ ok: false, text: msg(e) });
    }
  };

  const onModelFile = async (f: File) => {
    setDevErr('');
    setImporting(0);
    try {
      await importModelFile(f, setImporting);
      updateSettings({ deviceModelName: f.name });
      setDevFile(await getModelFile());
    } catch (e) {
      setDevErr(msg(e));
    } finally {
      setImporting(null);
    }
  };

  const doExport = async () => {
    const json = exportJson();
    const name = `kairo-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      if (Capacitor.isNativePlatform()) {
        const r = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
        await Share.share({ title: 'Sauvegarde Kairo', files: [r.uri] });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      setDataMsg('Sauvegarde exportée.');
    } catch (e) {
      setDataMsg(msg(e));
    }
  };

  const doImport = async (f: File) => {
    try {
      importJson(await f.text());
      setDataMsg('Sauvegarde restaurée.');
    } catch {
      setDataMsg('Fichier de sauvegarde illisible.');
    }
  };

  return (
    <div className="screen">
      <div className="scroll page" style={{ paddingBottom: 48 }}>
        <header className="row">
          <button className="icon-btn" aria-label="Retour" onClick={nav.back}><Icon name="back" size={18} /></button>
          <h1 className="h1" style={{ fontSize: 24 }}>Réglages</h1>
        </header>

        <Section title="Où tourne l’IA">
          <div className="seg" role="radiogroup" aria-label="Moteur d’IA">
            <button role="radio" aria-checked={s.backend === 'ollama'} className={s.backend === 'ollama' ? 'on' : ''} onClick={() => updateSettings({ backend: 'ollama' })}>Mon ordi (Ollama)</button>
            <button role="radio" aria-checked={s.backend === 'device'} className={s.backend === 'device' ? 'on' : ''} onClick={() => updateSettings({ backend: 'device' })}>Sur le téléphone</button>
          </div>

          {s.backend === 'ollama' ? (
            <>
              <label className="field">
                <span className="label">Adresse d’Ollama</span>
                <input className="input" inputMode="url" autoCapitalize="off" autoCorrect="off" value={s.ollamaUrl} onChange={(e) => updateSettings({ ollamaUrl: e.target.value })} />
                <span style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.45 }}>Sur le Mac : http://localhost:11434. Sur le téléphone : l’adresse IP du Mac sur ton Wi-Fi, ex. http://192.168.1.20:11434.</span>
              </label>
              <label className="field">
                <span className="label">Modèle</span>
                <input className="input" autoCapitalize="off" autoCorrect="off" value={s.ollamaModel} onChange={(e) => updateSettings({ ollamaModel: e.target.value.trim() })} />
                <span style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.45 }}>Conseillé : gemma4:e4b (texte + images). Plus léger : gemma4:e2b.</span>
              </label>
              <button className="btn" onClick={testOllama}>Tester la connexion</button>
              {test && <p className={test.ok ? '' : 'err'} style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: test.ok ? '#7bd88f' : undefined }}>{test.text}</p>}
              {models && models.length > 0 && (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {models.map((m) => <button key={m} className={`chip ${m === s.ollamaModel ? 'on' : ''}`} onClick={() => updateSettings({ ollamaModel: m })}>{m}</button>)}
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
                Expérimental. Le modèle tourne entièrement sur le téléphone (WebGPU). Il faut un modèle Gemma au format <b>.litertlm « -Web »</b> (≈ 3 Go), à télécharger une fois depuis Hugging Face, puis à importer ici.
              </p>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14 }}>WebGPU</span>
                <span className={`tag ${gpu ? 'accent' : ''}`}>{gpu === null ? '…' : gpu ? 'DISPONIBLE' : 'INDISPONIBLE'}</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{devFile ? s.deviceModelName || 'Modèle importé' : 'Aucun modèle'}</span>
                {devFile && <span className="tag">{(devFile.size / 1e9).toFixed(2)} GO</span>}
              </div>
              {importing !== null ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}><div style={{ width: `${Math.round(importing * 100)}%`, height: '100%', background: 'var(--a)' }} /></div>
                  <span className="label">Import… {Math.round(importing * 100)} %</span>
                </div>
              ) : (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn" style={{ flex: 1 }} onClick={() => modelInput.current?.click()}><Icon name="upload" size={16} />{devFile ? 'Remplacer' : 'Importer un modèle'}</button>
                  {devFile && <button className="btn danger" onClick={async () => { await deleteModelFile(); setDevFile(null); updateSettings({ deviceModelName: '' }); }}><Icon name="trash" size={16} /></button>}
                </div>
              )}
              <input ref={modelInput} type="file" accept=".litertlm,.task,.bin,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onModelFile(f); }} />
              {devErr && <p className="err" style={{ margin: 0 }}>{devErr}</p>}
            </>
          )}
        </Section>

        <Section title="Internet">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>Recherche web</span>
              <span style={{ fontSize: 12, color: 'var(--dim)' }}>L’IA cherche et lit des pages quand c’est utile</span>
            </span>
            <button className={`switch ${s.webEnabled ? 'on' : ''}`} role="switch" aria-checked={s.webEnabled} aria-label="Recherche web" onClick={() => updateSettings({ webEnabled: !s.webEnabled })} />
          </div>
          <label className="field">
            <span className="label">Clé API Ollama</span>
            <input className="input" type="password" autoComplete="off" value={s.ollamaApiKey} onChange={(e) => updateSettings({ ollamaApiKey: e.target.value.trim() })} placeholder="Colle ta clé ici" />
            <span style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.45 }}>Gratuite avec un compte sur ollama.com (Settings → Keys). Seules tes recherches passent par Ollama ; tes notes restent sur ton appareil.</span>
          </label>
          <button className="btn" disabled={!s.ollamaApiKey} onClick={testWeb}><Icon name="globe" size={16} />Tester la recherche</button>
          {webTest && <p className={webTest.ok ? '' : 'err'} style={{ margin: 0, fontSize: 13, color: webTest.ok ? '#7bd88f' : undefined }}>{webTest.text}</p>}
        </Section>

        <Section title="Apparence">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 15 }}>Couleur de l’IA</span>
            <div className="row" style={{ gap: 8 }}>
              {ACCENTS.map((c) => <button key={c} aria-label={`Couleur ${c}`} aria-pressed={s.accent === c} onClick={() => updateSettings({ accent: c })} style={{ width: 30, height: 30, borderRadius: 10, background: c, border: s.accent === c ? '2px solid var(--text)' : '2px solid transparent' }} />)}
            </div>
          </div>
        </Section>

        <Section title="Données">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>Tout est stocké uniquement sur cet appareil. Exporte une sauvegarde pour la garder ou la transférer (téléphone ↔ Mac).</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={doExport}><Icon name="download" size={16} />Exporter</button>
            <button className="btn" style={{ flex: 1 }} onClick={() => jsonInput.current?.click()}><Icon name="upload" size={16} />Restaurer</button>
          </div>
          <input ref={jsonInput} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) doImport(f); }} />
          {dataMsg && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{dataMsg}</p>}
        </Section>

        <p className="label" style={{ textAlign: 'center', paddingTop: 10 }}>Kairo · v1.0</p>
      </div>
    </div>
  );
}
