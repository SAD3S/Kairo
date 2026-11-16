import { AiStatus, STATUS_LABEL } from '../lib/ai/types';

/** Animation propre à chaque état de l'IA (voir la planche "loaders"). */
export function Loader({ status }: { status: AiStatus }) {
  const d = (s: number) => ({ animationDelay: `${s}s` });
  let inner: React.ReactElement;
  switch (status) {
    case 'listen':
      inner = <span className="eq">{[0, 0.15, 0.3, 0.45, 0.2].map((s, i) => <span key={i} style={d(s)} />)}</span>;
      break;
    case 'think':
      inner = <span className="mx">{[0, 0.1, 0.2, 0.1, 0.2, 0.3, 0.2, 0.3, 0.4].map((s, i) => <span key={i} style={d(s)} />)}</span>;
      break;
    case 'data':
      inner = (
        <span className="rd">
          <span style={{ width: 24 }} />
          <span style={{ width: 17, ...d(0.15) }} />
          <span style={{ width: 21, ...d(0.3) }} />
        </span>
      );
      break;
    case 'web':
      inner = <span className="orbit" />;
      break;
    case 'vision':
      inner = (
        <span className="scan">
          <span className="c tl" /><span className="c tr" /><span className="c bl" /><span className="c br" /><span className="ln" />
        </span>
      );
      break;
    case 'format':
      inner = <span className="fm"><span className="a" /><span className="b" /><span className="d" /></span>;
      break;
    case 'write':
      inner = <span className="wr"><i style={d(0)} /><i style={d(0.15)} /><i style={d(0.3)} /><b /></span>;
      break;
    default:
      inner = <span className="orb"><b /><i /></span>;
  }
  return <span className="ld" aria-hidden="true">{inner}</span>;
}

export function StatusPill({ status, sub, onClick }: { status: AiStatus; sub?: string; onClick?: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onClick}
      style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px 10px 10px', borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <Loader status={status} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{STATUS_LABEL[status]}</span>
        {sub && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#9a9aa3' }}>{sub}</span>}
      </span>
    </div>
  );
}
