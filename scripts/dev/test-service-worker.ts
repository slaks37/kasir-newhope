// Service worker behaviour in a sandbox with fake caches/fetch. No browser, no network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { serviceWorkerSource } from '../../src/pwa/serviceWorker';

const ORIGIN = 'https://kasir.example';
type Store = Map<string, Response>;
const stores = new Map<string, Store>([['nh-shell-old', new Map([['/index.html', new Response('old')]])]]);
const keyOf = (req: { url: string } | string) => { const u = new URL(typeof req === 'string' ? req : req.url, ORIGIN); return u.origin === ORIGIN ? u.pathname : u.href; };
const caches = {
  open: async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      addAll: async (urls: string[]) => { for (const u of urls) store.set(keyOf(u), new Response('cached:' + u, { headers: { 'content-type': u.endsWith('.html') ? 'text/html' : 'text/javascript' } })); },
      put: async (req: { url: string } | string, res: Response) => { store.set(keyOf(req), res); },
    };
  },
  match: async (req: { url: string } | string) => { for (const store of stores.values()) { const hit = store.get(keyOf(req)); if (hit) return hit.clone(); } return undefined; },
  keys: async () => [...stores.keys()],
  delete: async (name: string) => stores.delete(name),
};
let online = true; const fetched: string[] = [];
const fakeFetch = async (req: { url: string }) => { fetched.push(keyOf(req)); if (!online) throw new TypeError('Failed to fetch'); return new Response('net:' + keyOf(req), { headers: { 'content-type': keyOf(req).startsWith('/assets/') ? 'text/javascript' : 'text/html' } }); };
const listeners: Record<string, (event: any) => void> = {};
const self: any = { location: new URL(ORIGIN), addEventListener: (type: string, fn: any) => { listeners[type] = fn; }, clients: { claim: async () => {} } };
vm.runInNewContext(serviceWorkerSource('b1', ['/assets/main-abc.js', '/assets/Pos-def.js']), { self, caches, fetch: fakeFetch, URL, Response, Promise, setTimeout, Error });

const waitUntil = async (fn: (e: any) => void) => { let p: Promise<unknown> = Promise.resolve(); fn({ waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
const dispatch = async (url: string, init: { method?: string; mode?: string } = {}) => {
  let responded: Promise<Response> | null = null;
  const request = { url: new URL(url, ORIGIN).href, method: init.method || 'GET', mode: init.mode || 'cors' };
  listeners.fetch({ request, respondWith: (r: Promise<Response>) => { responded = r; } });
  return responded ? await (responded as Promise<Response>) : null;
};

await waitUntil(listeners.install);
assert.ok(stores.get('nh-shell-b1')!.has('/index.html') && stores.get('nh-shell-b1')!.has('/assets/Pos-def.js'), 'Shell and cashier assets are precached');
await waitUntil(listeners.activate);
assert.equal(stores.has('nh-shell-old'), false, 'Previous build caches are removed on activation');

// Online navigation goes to the network and refreshes the cached shell.
assert.equal(await (await dispatch('/pos', { mode: 'navigate' }))!.text(), 'net:/pos');
// Offline refresh still opens the app from the cached shell.
online = false;
assert.equal(await (await dispatch('/reports', { mode: 'navigate' }))!.text(), 'net:/pos', 'Offline navigation serves the last good index.html');
// Hashed assets come from cache, even offline.
assert.match(await (await dispatch('/assets/Pos-def.js'))!.text(), /cached:\/assets\/Pos-def\.js/);
// Never intercepted: API, admin, non-GET, other origins.
for (const [url, init] of [['/api/v1/sync/state', {}], ['/admin', { mode: 'navigate' }], ['/blog/cara-hitung-hpp', { mode: 'navigate' }], ['/sitemap.xml', {}], ['/assets/x.js', { method: 'POST' }], ['https://project.supabase.co/auth/v1/user', {}]] as const)
  assert.equal(await dispatch(url, init as any), null, url + ' must bypass the service worker');
console.log('PASS: service worker precaches the cashier shell, serves offline refresh, caches hashed assets, cleans old builds and never touches API/admin/blog/non-GET/cross-origin');
