// Safety shim to prevent "Uncaught TypeError: Cannot set property fetch of #<Window> which has only a getter"
try {
  const win = typeof window !== 'undefined' ? (window as any) : null;
  if (win && win.fetch) {
    let currentFetch = win.fetch;
    const desc = Object.getOwnPropertyDescriptor(win, 'fetch') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(win), 'fetch');
    if (desc && (desc.get || !desc.writable)) {
      Object.defineProperty(win, 'fetch', {
        configurable: true,
        enumerable: true,
        get() {
          return currentFetch;
        },
        set(v) {
          currentFetch = v;
        },
      });
    }
  }
} catch (e) {
  console.warn('Fetch setter shim error:', e);
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import { POSProvider } from './context/POSContext';
import { installAuthenticatedFetch } from './lib/authenticatedFetch';
import App from './App.tsx';
import './index.css';

installAuthenticatedFetch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <POSProvider>
        <App />
      </POSProvider>
    </AuthProvider>
  </StrictMode>,
);

