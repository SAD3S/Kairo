import { useNav } from '../nav';
import { Icon } from './Icon';

export function BottomNav({ active }: { active: 'home' | 'notes' | 'chat' | 'camera' | 'route' }) {
  const nav = useNav();
  const item = (key: typeof active, icon: string, label: string, extra = '') => (
    <button className={`${active === key ? 'on' : ''} ${extra}`} aria-label={label} aria-current={active === key ? 'page' : undefined} onClick={() => nav.tab({ name: key } as any)}>
      <Icon name={icon} size={key === 'chat' ? 22 : 20} />
    </button>
  );
  return (
    <nav className="nav" aria-label="Navigation">
      {item('home', 'grid', 'Habitudes')}
      {item('notes', 'note', 'Notes')}
      {item('chat', 'spark', 'Assistant IA', 'ai')}
      {item('camera', 'camera', 'Caméra')}
      {item('route', 'map', 'Itinéraire')}
    </nav>
  );
}
