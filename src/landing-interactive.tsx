import React from 'react';
import {flushSync} from 'react-dom';
import {hydrateRoot, createRoot} from 'react-dom/client';
import {HomePage} from './components/home/HomePage';

export function activateLanding(root: HTMLElement) {
  const disclosures = [...root.querySelectorAll<HTMLDetailsElement>('details[open]')];
  // Native disclosures can already be open before hydration. Preserve that
  // browser state without presenting changed attributes as an SSR mismatch.
  disclosures.forEach(details => { details.open = false; });
  // A range can change while its feature bundle is downloading. Initialize
  // React's tracker from SSR defaults, then the bootstrap replays the new value.
  root.querySelectorAll<HTMLInputElement>('input').forEach(input => {
    input.value = input.defaultValue;
  });
  const go = (path: string) => window.location.assign(path);
  const page = <HomePage isStandaloneLanding onOpenLogin={() => go('/login')}
    onOpenRegister={() => go('/register')} onOpenPOS={() => go('/pos')} onNavigate={go}/>;
  // Attach handlers before replaying the first action captured by the bootstrap.
  flushSync(() => {
    if (root.hasChildNodes()) hydrateRoot(root, page);
    else createRoot(root).render(page);
  });
  disclosures.forEach(details => { details.open = true; });
  return (action: () => void) => flushSync(action);
}
