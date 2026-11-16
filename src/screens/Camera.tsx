import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Icon } from '../components/Icon';
import { Loader } from '../components/Loader';
import { useNav } from '../nav';
import { getState, pushChat, uid } from '../lib/store';
import { runAgent } from '../lib/ai/agent';
import { CAMERA_PROMPTS } from '../lib/ai/context';
import { errorText } from '../lib/ai/session';
import { AiStatus, STATUS_LABEL } from '../lib/ai/types';
import { fileToJpeg, toJpeg } from '../lib/image';
import { Source } from '../lib/types';

// Image transparente 1×1 : évite l'affiche grise par défaut du lecteur vidéo d'Android.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const MODES = [
  { key: 'explain', label: 'Expliquer' },
  { key: 'read', label: 'Lire le texte' },
  { key: 'translate', label: 'Traduire' },
];

export function Camera() {
  const nav = useNav();
  const video = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [camErr, setCamErr] = useState('');
  const [mode, setMode] = useState('explain');
  const [question, setQuestion] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [status, setStatus] = useState<AiStatus>('idle');
  const [sub, setSub] = useState<string | undefined>();
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCamErr('');
    setLive(false);
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setCamErr('Caméra inaccessible. Autorise la caméra pour Kairo dans les réglages du téléphone.'));
    if (!navigator.mediaDevices) setCamErr('Caméra non disponible ici.');
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  useEffect(() => () => abort.current?.abort(), []);

  const prompt = () => {
    const q = question.trim();
    // Une question précise passe avant le mode : on répond juste à elle.
    if (q) return mode === 'explain' ? `${q}\n\n(Réponds seulement à cette question, en t'appuyant sur l'image, sans la décrire.)` : `${CAMERA_PROMPTS[mode]}\n\nPuis réponds brièvement à : ${q}`;
    return CAMERA_PROMPTS[mode];
  };

  const analyse = async (img: string) => {
    setShot(img);
    setAnswer('');
    setSources([]);
    setBusy(true);
    abort.current = new AbortController();
    try {
      const r = await runAgent({
        data: getState(),
        history: [],
        text: prompt(),
        image: img,
        signal: abort.current.signal,
        onStatus: (s, sb) => { setStatus(s); setSub(sb); },
        onText: setAnswer,
      });
      setAnswer(r.text);
      setSources(r.sources);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setAnswer(errorText(e));
    } finally {
      setBusy(false);
      setStatus('idle');
      setSub(undefined);
    }
  };

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth || busy) return;
    analyse(toJpeg(v, v.videoWidth, v.videoHeight));
  };

  const continueInChat = () => {
    if (!shot || !answer) return;
    const label = MODES.find((m) => m.key === mode)!.label;
    pushChat({ id: uid(), role: 'user', text: question.trim() || `${label} cette photo`, image: shot, at: Date.now() });
    pushChat({ id: uid(), role: 'assistant', text: answer, sources, at: Date.now() });
    nav.tab({ name: 'chat' });
  };

  const reset = () => {
    abort.current?.abort();
    setShot(null);
    setAnswer('');
  };

  return (
    <div className="screen vf" style={{ overflow: 'hidden' }}>
      <video
          ref={video}
          autoPlay
          playsInline
          muted
          disablePictureInPicture
          controls={false}
          poster={BLANK}
          onPlaying={() => setLive(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: 'transparent', opacity: live ? 1 : 0, transition: 'opacity .25s', transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
        />
      {shot && <img src={shot} alt="Photo analysée" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}

      <div className="row" style={{ position: 'absolute', top: 'calc(var(--top) + 8px)', left: 16, right: 16, justifyContent: 'space-between', zIndex: 2 }}>
        <button className="icon-btn glass" aria-label="Fermer la caméra" onClick={nav.back}><Icon name="close" size={18} stroke={2} /></button>
        <span className="label glass" style={{ padding: '6px 10px', borderRadius: 9, color: 'var(--muted)' }}>Montre-moi</span>
        <button className="icon-btn glass" aria-label="Retourner la caméra" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}><Icon name="flip" size={18} /></button>
      </div>

      {!shot && (
        <div className="frame" aria-hidden="true" style={{ top: '18%', left: '13%', right: '13%', aspectRatio: '1' }}>
          <span className="c tl" /><span className="c tr" /><span className="c bl" /><span className="c br" />
          {camErr ? null : <span className="ln" />}
        </div>
      )}
      {camErr && !shot && <p className="err glass" style={{ position: 'absolute', top: '30%', left: 32, right: 32, padding: 14, borderRadius: 16, textAlign: 'center' }}>{camErr}</p>}

      <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'calc(var(--bottom) + 132px)', display: 'flex', flexDirection: 'column', gap: 10, zIndex: 2 }}>
        {!shot && (
          <>
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
              {MODES.map((m) => (
                <button key={m.key} className={`chip ${mode === m.key ? 'on' : 'glass'}`} onClick={() => setMode(m.key)}>{m.label}</button>
              ))}
            </div>
            <input className="input glass" aria-label="Question sur l’image (facultatif)" placeholder="Une question précise ? (facultatif)" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </>
        )}
        {shot && (
          <div className="glass scroll rise" style={{ padding: '14px 16px', borderRadius: 22, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '46vh' }}>
            <div className="row" style={{ gap: 10 }}>
              <Loader status={busy ? status : 'idle'} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{busy ? STATUS_LABEL[status] : 'Réponse'}</span>
              {busy && sub && <span className="label" style={{ marginLeft: 'auto', fontSize: 10 }}>{sub}</span>}
            </div>
            {answer ? <div className="md"><Markdown>{answer}</Markdown>{busy && <span className="caret" aria-hidden="true" />}</div> : busy ? null : <span className="muted">Pas de réponse.</span>}
            {!busy && (
              <div className="row" style={{ gap: 8 }}>
                <button className="btn small" onClick={reset}><Icon name="camera" size={16} />Nouvelle photo</button>
                {answer && <button className="btn small primary" onClick={continueInChat}><Icon name="chat" size={16} />Continuer</button>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="row" style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(var(--bottom) + 28px)', justifyContent: 'center', gap: 44, zIndex: 2 }}>
        <button className="icon-btn glass" style={{ width: 48, height: 48, borderRadius: 14 }} aria-label="Choisir une image" onClick={() => fileRef.current?.click()}><Icon name="image" /></button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) analyse(await fileToJpeg(f)); }} />
        <button aria-label="Analyser l’image" disabled={busy || !!shot || !!camErr} onClick={capture} style={{ width: 76, height: 76, borderRadius: '50%', background: 'transparent', border: '3px solid var(--text)', padding: 5, opacity: busy || shot ? 0.5 : 1 }}>
          <span style={{ display: 'block', width: '100%', height: '100%', borderRadius: '50%', background: 'var(--a)' }} />
        </button>
        <button className="icon-btn glass" style={{ width: 48, height: 48 }} aria-label="Ouvrir l’assistant" onClick={() => nav.tab({ name: 'chat' })}><Icon name="spark" /></button>
      </div>
    </div>
  );
}
