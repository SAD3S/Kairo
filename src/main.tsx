import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { App } from './App';
import { loadStore } from './lib/store';
import { perfMark } from './lib/perf';

loadStore().then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
  // Deux images plus tard, le premier écran est réellement à l'écran.
  requestAnimationFrame(() => requestAnimationFrame(() => perfMark('app.start', performance.now(), 'depuis le chargement de la page')));
});
