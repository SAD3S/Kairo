import { useState } from 'react';
import { createFolder, useStore } from '../lib/store';
import { Icon } from './Icon';

/** Feuille du bas : choisir un dossier existant ou en créer un nouveau. */
export function FolderSheet({ currentId, onPick, onClose }: { currentId?: string; onPick: (id: string | undefined) => void; onClose: () => void }) {
  const folders = useStore((s) => s.folders);
  const notes = useStore((s) => s.notes);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(folders.length === 0);

  const pick = (id: string | undefined) => {
    onPick(id);
    onClose();
  };
  const create = () => {
    const id = createFolder(name);
    if (id) pick(id);
  };
  const count = (id: string) => notes.filter((n) => n.folderId === id).length;
  const row = (selected: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 50, padding: '0 14px', borderRadius: 14, textAlign: 'left',
    border: '1px solid ' + (selected ? 'color-mix(in srgb, var(--a) 60%, transparent)' : 'var(--line)'),
    background: selected ? 'color-mix(in srgb, var(--a) 12%, var(--surface))' : 'var(--surface)', color: 'var(--text)', fontSize: 15,
  });

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Ranger dans un dossier" onClick={(e) => e.stopPropagation()}>
        <span className="grip" />
        <span style={{ fontSize: 17, fontWeight: 600 }}>Ranger dans un dossier</span>

        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh' }}>
          <button style={row(!currentId)} onClick={() => pick(undefined)}>
            <span style={{ color: 'var(--dim)' }}><Icon name="note" size={18} /></span>
            <span style={{ flex: 1 }}>Aucun dossier</span>
            {!currentId && <span style={{ color: 'var(--a)' }}><Icon name="check" size={18} stroke={2.2} /></span>}
          </button>
          {folders.map((f) => (
            <button key={f.id} style={row(currentId === f.id)} onClick={() => pick(f.id)} aria-pressed={currentId === f.id}>
              <span style={{ color: 'var(--a)' }}><Icon name="folder" size={18} /></span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span className="label" style={{ fontSize: 10 }}>{count(f.id)}</span>
              {currentId === f.id && <span style={{ color: 'var(--a)' }}><Icon name="check" size={18} stroke={2.2} /></span>}
            </button>
          ))}
        </div>

        {creating ? (
          <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); create(); }}>
            <input className="input" autoFocus aria-label="Nom du nouveau dossier" placeholder="Nom du dossier, ex. Films" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} style={{ flex: 1 }} />
            <button className="btn primary" type="submit" disabled={!name.trim()}>Créer</button>
          </form>
        ) : (
          <button className="btn" onClick={() => setCreating(true)}><Icon name="folderPlus" size={18} />Nouveau dossier</button>
        )}
      </div>
    </div>
  );
}

/** Feuille pour créer ou renommer un dossier (avec suppression en option). */
export function FolderEditSheet({ initial = '', onSave, onDelete, onClose }: { initial?: string; onSave: (name: string) => void; onDelete?: () => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={initial ? 'Modifier le dossier' : 'Nouveau dossier'} onClick={(e) => e.stopPropagation()}>
        <span className="grip" />
        <span style={{ fontSize: 17, fontWeight: 600 }}>{initial ? 'Modifier le dossier' : 'Nouveau dossier'}</span>
        <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave(name); onClose(); } }}>
          <input className="input" autoFocus aria-label="Nom du dossier" placeholder="Ex. Films, Cours, Idées…" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <button className="btn primary" type="submit" disabled={!name.trim()}>{initial ? 'Renommer' : 'Créer le dossier'}</button>
        </form>
        {onDelete && (confirm ? (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => setConfirm(false)}>Garder</button>
            <button className="btn danger" style={{ flex: 1 }} onClick={() => { onDelete(); onClose(); }}>Supprimer</button>
          </div>
        ) : (
          <button className="btn danger small" onClick={() => setConfirm(true)}><Icon name="trash" size={14} />Supprimer le dossier (les notes sont gardées)</button>
        ))}
      </div>
    </div>
  );
}
