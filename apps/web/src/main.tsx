import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import DemoStudio from './DemoStudio';
import './styles.css';
import './editorial-v2.css';
import './card-system-v3.css';
import './liquid-glass.css';
import { installSafeArea } from './safe-area';

void installSafeArea();
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
const studioMode = import.meta.env.DEV && new URLSearchParams(location.search).get('studio') === '1';
createRoot(document.getElementById('root')!).render(<StrictMode>{studioMode ? <DemoStudio /> : <App />}</StrictMode>);
