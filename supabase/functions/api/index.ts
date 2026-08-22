import { Hono } from 'hono';
import { cors } from 'hono/cors';
import "@supabase/functions-js/edge-runtime.d.ts";

// Import all service instances
import posAppPromise from '../../../services/pos/index.ts';
import aiAppPromise from '../../../services/ai/index.ts';
import billingAppPromise from '../../../services/billing/index.ts';
import backofficeAppPromise from '../../../services/backoffice/index.ts';

const app = new Hono();

// Enable Global CORS for all origins
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-internal-user', 'x-request-id', 'x-device-id', 'x-justification', 'x-env-override', 'apikey'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  exposeHeaders: ['x-request-id'],
  maxAge: 86400,
}));

// Await the instantiation of all modular monolith services
const posApp = await posAppPromise;
const aiApp = await aiAppPromise;
const billingApp = await billingAppPromise;
const backofficeApp = await backofficeAppPromise;

const root = new Hono();
root.route('/', posApp);
root.route('/', aiApp);
root.route('/', billingApp);
root.route('/', backofficeApp);

// Mount router under root and prefixes to handle any proxy/invocation style
app.route('/functions/v1/api', root);
app.route('/api', root);
app.route('/', root);

app.get('/health', (c) => {
  return c.json({ ok: true, status: 'Edge Functions running' });
});

// Export the fetch handler for Deno / Supabase Edge Runtime
export default {
  fetch: app.fetch
};
