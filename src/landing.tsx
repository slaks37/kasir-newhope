import React from 'react';
import {hydrateRoot, createRoot} from 'react-dom/client';
import {HomePage} from './components/home/HomePage';
import {legacyHashPath} from './lib/navigation/routes';
import './landing-base.css';

// Public marketing never needs session restoration, tenant data or an offline cache.
// Authentication and checkout resume in the application on navigation.
const go = (path: string) => window.location.assign(path);
const legacy = legacyHashPath(window.location.hash);
if (legacy) window.location.replace(legacy);
else {
  const root = document.getElementById('root')!;
  const page = <HomePage isStandaloneLanding onOpenLogin={() => go('/login')}
    onOpenRegister={() => go('/register')} onOpenPOS={() => go('/pos')} onNavigate={go}/>;
  if (root.hasChildNodes()) hydrateRoot(root, page);
  else createRoot(root).render(page);
}
