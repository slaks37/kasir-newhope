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
import { AuthProvider, useAuth } from './context/AuthContext';
import { POSProvider } from './context/POSContext';
import { installAuthenticatedFetch } from './lib/authenticatedFetch';
import App from './App';
import './index.css';
import './styles/app-theme.css';

installAuthenticatedFetch();

// Do not initialize or persist account-scoped POS state under an anonymous
// fallback while the saved Auth session is still being restored.
function POSSession() {
  const {user,loading}=useAuth();
  if(loading) return <div className="nh-auth min-h-screen grid place-items-center" role="status">Memuat ruang kerja…</div>;
  return <POSProvider key={user?.id || 'guest'}><App /></POSProvider>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <POSSession />
    </AuthProvider>
  </StrictMode>,
);
