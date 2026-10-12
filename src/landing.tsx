import {legacyHashPath} from './lib/navigation/routes';
import {registerServiceWorker} from './pwa/serviceWorker';
import './landing-base.css';
import './components/home/landing.css';

// Public marketing never needs session restoration, tenant data or an offline cache.
// Authentication and checkout resume in the application on navigation.
// Returning cashier devices update an existing worker. First-time marketing
// visitors do not download or precache the operational application.
if (navigator.serviceWorker?.controller) registerServiceWorker();
const legacy = legacyHashPath(window.location.hash);
if (legacy) window.location.replace(legacy);
else {
  const root = document.getElementById('root')!;
  let ready = false;
  let loading: Promise<void> | undefined;
  const pending: Array<() => void> = [];
  const activate = () => loading ??= import('./landing-interactive').then(({activateLanding}) => {
    const replay = activateLanding(root);
    ready = true;
    document.getElementById('nh-load-status')?.remove();
    root.removeAttribute('aria-busy');
    // Commit each action before the next one. For example, a queued billing
    // toggle must update the plan handler before a queued checkout click.
    while (pending.length) replay(pending.shift()!);
  }).catch(error => {
    loading = undefined;
    pending.length = 0;
    root.removeAttribute('aria-busy');
    console.error('Landing interaction failed to load', error);
    let status = document.getElementById('nh-load-status');
    if (!status) {
      status = document.createElement('p');
      status.id = 'nh-load-status';
      status.className = 'nh-load-error';
      status.setAttribute('role', 'alert');
      document.body.appendChild(status);
    }
    status.textContent = 'Fitur belum berhasil dimuat. Periksa koneksi, lalu muat ulang halaman. ';
    // Browsers can cache a rejected module import for the lifetime of the page.
    // An explicit reload retries the fetch instead of promising a broken retry.
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Muat ulang halaman';
    retry.addEventListener('click', () => window.location.reload());
    status.appendChild(retry);
  });
  const control = (event: Event) => event.target instanceof Element
    ? event.target.closest<HTMLElement>('button,input,[data-landing-interactive]') : null;
  const warm = (event: Event) => {
    const target = control(event);
    if (!ready && target && !target.dataset.landingHref) void activate();
  };
  root.addEventListener('pointerover', warm, {passive: true});
  root.addEventListener('focusin', warm);
  root.addEventListener('click', event => {
    if (ready) return;
    const target = control(event);
    if (!target) return; // Anchors and native details work without React.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target.dataset.landingHref) {
      window.location.assign(target.dataset.landingHref);
      return;
    }
    root.setAttribute('aria-busy', 'true');
    pending.push(() => target.click());
    void activate();
  }, true);
  root.addEventListener('input', event => {
    if (ready || !(event.target instanceof HTMLInputElement)) return;
    const target = event.target;
    const value = target.value;
    event.stopImmediatePropagation();
    pending.push(() => {
      // Bypass React's value tracker so the first range input updates state.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value);
      target.dispatchEvent(new Event('input', {bubbles: true}));
    });
    void activate();
  }, true);
  root.addEventListener('keydown', event => {
    const target = control(event);
    if (ready || target?.getAttribute('role') !== 'tab' ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pending.push(() => target.dispatchEvent(new KeyboardEvent('keydown', {
      key: event.key, bubbles: true, cancelable: true,
    })));
    void activate();
  }, true);
  // Development has no build-time HTML; render eagerly only in that case.
  if (!root.hasChildNodes()) void activate();
}
