import { createContext, useContext } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'habit'; id: string }
  | { name: 'habitForm'; id?: string }
  | { name: 'chat'; noteId?: string; prefill?: string }
  | { name: 'camera' }
  | { name: 'notes' }
  | { name: 'note'; id: string }
  | { name: 'settings' }
  | { name: 'route' };

export interface Nav {
  route: Route;
  go: (r: Route) => void;
  /** Change d'onglet (remplace la pile). */
  tab: (r: Route) => void;
  back: () => void;
}

export const NavCtx = createContext<Nav>(null as any);
export const useNav = () => useContext(NavCtx);
