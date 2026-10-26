import {InstallHelp} from './pwa/InstallHelp';
import {isNative} from './platform/runtime/platform';
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

import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './i18n/LanguageContext';
import { installAuthenticatedFetch } from './lib/authenticatedFetch';
import App from './App';
import './index.css';
import { normalizeLegacyRoute } from './lib/navigation/workspaceRouter';
import { registerServiceWorker } from './pwa/serviceWorker';

installAuthenticatedFetch();
normalizeLegacyRoute();
if(isNative())void import('./platform/runtime/nativeLifecycle').then(m=>m.installNativeLifecycle()).catch(()=>window.dispatchEvent(new CustomEvent("native-auth-error")));
registerServiceWorker();
const NativeStatus=lazy(()=>import('./platform/runtime/NativeStatus').then(m=>({default:m.NativeStatus})));
const McpConnections = lazy(() => import('./components/mcp/McpConnections').then(m => ({ default: m.McpConnections })));
const Notifier = lazy(() => import('./components/ui/Notifier').then(m => ({ default: m.Notifier })));

// Fast-path: public landing page ('/') and auth routes render without waiting for
// the Supabase session restoration roundtrip. Account-scoped workspace routes wait.
function POSSession() {
  const {user,loading}=useAuth();
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const isPublicRoute = pathname === '/' || pathname === '/login' || pathname === '/register' || pathname === '/reset-password';
  if(loading && !isPublicRoute) return <div className="nh-auth min-h-screen grid place-items-center" role="status">Memuat ruang kerja…</div>;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      {isNative()&&<Suspense fallback={null}><NativeStatus/></Suspense>}
      <AuthProvider>
        {window.location.pathname === '/mcp/connect' || window.location.pathname === '/mcp/connections'
          ? <Suspense fallback={<p role="status">Memuat koneksi MCP…</p>}><McpConnections consent={window.location.pathname === '/mcp/connect'} /></Suspense>
          : <POSSession />}
      </AuthProvider>
    </LanguageProvider>
    <Suspense fallback={null}>
      <Notifier /><InstallHelp />
    </Suspense>
  </StrictMode>,
);
