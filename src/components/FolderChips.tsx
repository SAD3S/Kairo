import { useLayoutEffect, useRef, useState } from 'react';
import { Folder } from '../lib/types';
import { Icon } from './Icon';

const GAP = 8;

/** Rangée de dossiers sur une seule ligne : ce qui ne tient pas passe dans « ⋯ ». */
export function FolderChips({
  folders,
  selected,
  count,
  onSelect,
  onMore,
  onNew,
}: {
  folders: Folder[];
  selected: string | null;
  count: (id: string) => number;
  onSelect: (id: string | null) => void;
  onMore: () => void;
  onNew: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(folders.length);

  // Le dossier sélectionné reste toujours visible.
  const sel = folders.find((f) => f.id === selected);
  const ordered = sel && folders.indexOf(sel) >= fit ? [sel, ...folders.filter((f) => f !== sel)] : folders;

  useLayoutEffect(() => {
    const compute = () => {
      const box = wrap.current;
      const m = measure.current;
      if (!box || !m) return;
      const kids = Array.from(m.children) as HTMLElement[];
      // kids : [Toutes, ...dossiers, ⋯, +]
      const width = box.clientWidth;
      const all = kids[0].offsetWidth;
      const more = kids[kids.length - 2].offsetWidth;
      const plus = kids[kids.length - 1].offsetWidth;
      const chips = kids.slice(1, -2).map((k) => k.offsetWidth);
      const total = all + plus + chips.reduce((a, w) => a + w + GAP, 0) + GAP;
      if (total <= width) return setFit(chips.length);
      let used = all + plus + more + GAP * 2;
      let n = 0;
      for (const w of chips) {
        if (used + w + GAP > width) break;
        used += w + GAP;
        n++;
      }
      setFit(n);
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [folders, selected]);

  const chip = (f: Folder) => (
    <button key={f.id} role="tab" aria-selected={selected === f.id} className={`chip ${selected === f.id ? 'on' : ''}`} onClick={() => onSelect(f.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 170 }}>
      <Icon name="folder" size={14} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
      <span style={{ opacity: 0.6, fontFamily: 'var(--mono)', fontSize: 11 }}>{count(f.id)}</span>
    </button>
  );
  const hidden = ordered.length - fit;
  const moreBtn = (
    <button className="chip" aria-label={`Voir tous les dossiers (${hidden} de plus)`} onClick={onMore} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 12px' }}>
      <Icon name="more" size={16} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{hidden > 0 ? `+${hidden}` : ''}</span>
    </button>
  );
  const plusBtn = (
    <button className="chip" aria-label="Nouveau dossier" onClick={onNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: folders.length ? '0 12px' : undefined }}>
      <Icon name="folderPlus" size={15} />{folders.length ? '' : 'Nouveau dossier'}
    </button>
  );

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      {/* Mesure invisible de toutes les puces */}
      <div ref={measure} aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', display: 'flex', gap: GAP, whiteSpace: 'nowrap' }}>
        <button className="chip" tabIndex={-1}>Toutes</button>
        {ordered.map(chip)}
        {moreBtn}
        {plusBtn}
      </div>
      <div className="row" role="tablist" aria-label="Dossiers" style={{ gap: GAP, flexWrap: 'nowrap', overflow: 'hidden' }}>
        <button role="tab" aria-selected={selected === null} className={`chip ${selected === null ? 'on' : ''}`} onClick={() => onSelect(null)}>Toutes</button>
        {ordered.slice(0, fit).map(chip)}
        {hidden > 0 && moreBtn}
        {plusBtn}
      </div>
    </div>
  );
}
