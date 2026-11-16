import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { BottomNav } from '../components/BottomNav';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/Loader';
import { useNav } from '../nav';
import { clearChat, updateSettings, useStore } from '../lib/store';
import { sendChat, setListening, stopChat, useSession } from '../lib/ai/session';
import { backendFor } from '../lib/ai/agent';
import { hostOf } from '../lib/ai/web';
import { fileToJpeg } from '../lib/image';
import { Dictation, startDictation } from '../lib/speech';
import { ChatMsg } from '../lib/types';

function Bubble({ m }: { m: ChatMsg }) {
  if (m.role === 'user') {
    return (
      <div style={{ alignSelf: 'flex-end', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, maxWidth: '82%' }}>
        {m.image && <img src={m.image} alt="Photo envoyée" style={{ width: 180, borderRadius: 16, border: '1px solid var(--line)' }} />}
        {m.text && <div style={{ padding: '11px 14px', borderRadius: '18px 18px 6px 18px', background: '#1e1e23', fontSize: 15, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{m.text}</div>}
      </div>
    );
  }
  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '94%' }}>
      {!!m.used?.length && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {m.used.map((u) => <span key={u} className="tag">{u}</span>)}
          {!!m.sources?.length && <span className="tag accent">WEB · {m.sources.length}</span>}
        </div>
      )}
      <div className="md" style={m.error ? { color: 'var(--danger)' } : undefined}><Markdown>{m.text}</Markdown></div>
      {!!m.sources?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {m.sources.map((s, i) => (
            <a key={s.url + i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              [{i + 1}] {hostOf(s.url)} · {s.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Chat({ noteId, prefill }: { noteId?: string; prefill?: string }) {
  const nav = useNav();
  const chat = useStore((s) => s.chat);
  const data = useStore((s) => s);
  const note = useStore((s) => (noteId ? s.notes.find((n) => n.id === noteId) : undefined));
  const session = useSession();
  const [text, setText] = useState(prefill ?? '');
  const [image, setImage] = useState<string | undefined>();
  const [dictErr, setDictErr] = useState('');
  const dict = useRef<Dictation | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const label = backendFor(data).label;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, session.draft, session.status]);

  const send = () => {
    const t = text.trim();
    if ((!t && !image) || session.busy) return;
    dict.current?.stop();
    sendChat(t, image, noteId);
    setText('');
    setImage(undefined);
  };

  const toggleMic = async () => {
    setDictErr('');
    if (dict.current) {
      await dict.current.stop();
      return;
    }
    try {
      setListening(true);
      dict.current = await startDictation(
        (t) => setText(t),
        () => {
          dict.current = null;
          setListening(false);
        },
      );
    } catch (e: any) {
      dict.current = null;
      setListening(false);
      setDictErr(e?.message || 'Dictée indisponible');
    }
  };

  const showPill = session.busy || session.status === 'listen';

  return (
    <div className="screen">
      <header className="row" style={{ padding: 'calc(var(--top) + 10px) 16px 12px', borderBottom: '1px solid #1c1c20', gap: 12 }}>
        <button className="icon-btn" aria-label="Retour" onClick={nav.back}><Icon name="back" size={18} /></button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>Assistant</span>
          <span className="row" style={{ gap: 6 }}>
            <span className="tag">{label}</span>
            <button className={`tag ${data.settings.webEnabled ? 'accent' : ''}`} onClick={() => updateSettings({ webEnabled: !data.settings.webEnabled })} aria-pressed={data.settings.webEnabled}>
              WEB {data.settings.webEnabled ? 'ON' : 'OFF'}
            </button>
          </span>
        </div>
        <button className="icon-btn" aria-label="Nouvelle conversation" disabled={session.busy || !chat.length} onClick={clearChat}><Icon name="trash" size={18} /></button>
      </header>

      <div ref={listRef} className="scroll" style={{ flex: 1, padding: '18px 16px 190px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {chat.length === 0 && !session.busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
            <span className="label">Exemples</span>
            {['Fais-moi le bilan de ma semaine', 'Résume mes notes récentes', 'Quelles sont les actus tech du jour ?'].map((q) => (
              <button key={q} className="card link" style={{ fontSize: 15 }} onClick={() => setText(q)}>{q}</button>
            ))}
          </div>
        )}
        {chat.map((m) => <Bubble key={m.id} m={m} />)}
        {session.busy && session.draft && (
          <div className="md" style={{ maxWidth: '94%' }}><Markdown>{session.draft}</Markdown><span className="caret" aria-hidden="true" /></div>
        )}
        {showPill && <StatusPill status={session.status} sub={session.sub} />}
      </div>

      <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'calc(var(--bottom) + 72px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(note || image || dictErr) && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {note && <span className="tag accent">NOTE · {(note.title || 'Sans titre').toUpperCase().slice(0, 28)}</span>}
            {image && (
              <span className="row" style={{ gap: 6 }}>
                <img src={image} alt="Image jointe" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
                <button className="tag" onClick={() => setImage(undefined)}>RETIRER</button>
              </span>
            )}
            {dictErr && <span className="err">{dictErr}</span>}
          </div>
        )}
        <div className="row" style={{ gap: 6, padding: '6px 6px 6px 8px', borderRadius: 24, background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <button className="icon-btn ghost" aria-label="Joindre une image" onClick={() => fileRef.current?.click()}><Icon name="image" /></button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await fileToJpeg(f)); e.target.value = ''; }} />
          <textarea
            aria-label="Message à l’IA"
            placeholder="Demande ou dicte…"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(); } }}
            style={{ flex: 1, minWidth: 0, maxHeight: 120, border: 'none', background: 'transparent', outline: 'none', fontSize: 15, resize: 'none', padding: '12px 0', lineHeight: 1.35 }}
          />
          <button className="icon-btn ghost" aria-label={session.status === 'listen' ? 'Arrêter la dictée' : 'Dicter'} aria-pressed={session.status === 'listen'} onClick={toggleMic} style={session.status === 'listen' ? { color: 'var(--a)' } : undefined}><Icon name="mic" /></button>
          {session.busy ? (
            <button className="icon-btn accent" aria-label="Arrêter" onClick={stopChat}><Icon name="stop" size={16} /></button>
          ) : (
            <button className="icon-btn accent" aria-label="Envoyer" disabled={!text.trim() && !image} onClick={send}><Icon name="send" size={18} stroke={2.2} /></button>
          )}
        </div>
      </div>
      <BottomNav active="chat" />
    </div>
  );
}
