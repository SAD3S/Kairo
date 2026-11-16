import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { App } from './App';
import { loadStore } from './lib/store';

loadStore().then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
