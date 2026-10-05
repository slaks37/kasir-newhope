import type express from 'express';
import type { Db } from '../../services/shared/db';
import { mcpConfig } from '../../services/mcp/routes';
import { mcpAdminSettings } from '../../services/mcp/settings';
import { MCP_SCOPE } from '../../services/mcp/tools';
import type { InternalCapability } from '../lib/rbac/environments';

export function integrationProviders(env: NodeJS.ProcessEnv = process.env) {
  const configured = (...keys: string[]) => keys.every(key => Boolean(env[key]?.trim()));
  return [
    { id: 'supabase', name: 'Supabase', purpose: 'Database dan autentikasi akun', configured: configured('DATABASE_URL') && (configured('SUPABASE_URL','SUPABASE_ANON_KEY') || configured('VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY')), dashboard: 'https://supabase.com/dashboard/project/fqxrhumsgigcgjtlbfuo', note: 'Status berdasarkan konfigurasi server; bukan pemeriksaan uptime.' },
    { id: 'doku', name: 'DOKU', purpose: 'Pembayaran langganan', configured: configured('DOKU_CLIENT_ID','DOKU_SECRET_KEY'), dashboard: 'https://dashboard.doku.com/', note: (env.DOKU_API_URL || 'https://api.doku.com').includes('api-sandbox') ? 'Mode sandbox; bukan pembayaran produksi.' : 'Endpoint produksi; periksa aktivasi channel di dashboard DOKU.' },
    { id: 'resend', name: 'Resend', purpose: 'Email bantuan akun dan billing', configured: configured('RESEND_API_KEY'), dashboard: 'https://resend.com/api-keys', note: 'Keberadaan kunci tidak memastikan domain pengirim telah diverifikasi.' },
    { id: 'deepseek', name: 'DeepSeek', purpose: 'Analisis AI berbayar', configured: configured('DEEPSEEK_API_KEY'), dashboard: 'https://platform.deepseek.com/api_keys', note: 'Penggunaan mengikuti batas akun dan paket di layanan AI.' },
    { id: 'agnes', name: 'Agnes AI', purpose: 'Penyedia AI alternatif', configured: configured('AGNES_API_KEY'), dashboard: 'https://apihub.agnes-ai.com/', note: 'Status hanya konfigurasi; pilihan model mengikuti layanan AI.' },
  ];
}
export const INTEGRATION_API_CATALOG = [
  { method: 'GET', path: '/api/v1/subscription/plans', auth: 'Publik', purpose: 'Katalog paket' },
  { method: 'GET', path: '/api/v1/subscription/status', auth: 'Bearer JWT akun owner', purpose: 'Langganan dan kapasitas akun' },
  { method: 'GET', path: '/api/v1/sync/business', auth: 'Bearer JWT akun owner', purpose: 'Bisnis dan outlet akun' },
  { method: 'GET', path: '/api/v1/reports/summary', auth: 'Bearer JWT akun; tenant dan outlet tervalidasi', purpose: 'Ringkasan laporan cloud' },
  { method: 'GET', path: '/api/admin/integrations', auth: 'Bearer JWT Superadmin + MFA', purpose: 'Inventaris integrasi dan koneksi' },
  { method: 'PUT', path: '/api/admin/integrations/mcp', auth: 'Bearer JWT Superadmin + MFA baru', purpose: 'Simpan pengaturan layanan MCP' },
  { method: 'POST', path: '/api/admin/integrations/mcp/connections/{id}/revoke', auth: 'Bearer JWT Superadmin + MFA baru', purpose: 'Cabut satu koneksi MCP' },
];
export function registerAdminIntegrationRoutes(app: express.Express, getDb: () => Promise<Db>, guard: (capability: InternalCapability) => express.RequestHandler) {
  const route = (fn: (req: any, res: express.Response, db: Db) => Promise<any>): express.RequestHandler => (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    Promise.resolve().then(async () => fn(req, res, await getDb())).catch(next);
  };
  app.get('/api/admin/integrations', guard('MANAGE_INTEGRATIONS'), route(async (req, res, db) => {
    const config = mcpConfig(), setting = await mcpAdminSettings(db);
    const present = (await db.query("SELECT to_regclass('mcp_private.connections') IS NOT NULL AND to_regclass('mcp_private.audit') IS NOT NULL AND to_regclass('mcp_private.credentials') IS NOT NULL AS ready")).rows[0]?.ready === true;
    let connections: any[] = [], events: any[] = [];
    const offset = Math.max(0, Math.min(100000, Number(req.query.offset) || 0));
    let total = 0, active = 0;
    if (present) {
      const results = await Promise.all([
        db.query(`SELECT c.id,c.owner_ref,c.business_id,c.client_id,c.created_at,c.expires_at,c.revoked_at,
          COALESCE(m.name,c.business_id) AS business_name,
          EXISTS(SELECT 1 FROM mcp_private.credentials k WHERE k.connection_id=c.id AND k.kind IN ('access','refresh')) AS connected,
          (SELECT max(a.created_at) FROM mcp_private.audit a WHERE a.connection_id=c.id AND a.event='tool_read') AS last_used_at
          FROM mcp_private.connections c LEFT JOIN LATERAL (
            SELECT m.name FROM internal.tenants t JOIN internal.merchants m ON m.tenant_id=t.id
            WHERE t.owner_user_ref=c.owner_ref AND t.merged_into IS NULL AND COALESCE(m.external_ref,m.id::text)=c.business_id
            ORDER BY m.id LIMIT 1
          ) m ON true
          ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET $1`, [offset]),
        db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>now())::int AS active FROM mcp_private.connections"),
        db.query(`SELECT a.event,a.tool,a.created_at,c.client_id,c.business_id FROM mcp_private.audit a JOIN mcp_private.connections c ON c.id=a.connection_id ORDER BY a.created_at DESC,a.id DESC LIMIT 30`),
      ]);
      connections = results[0].rows; total = Number(results[1].rows[0]?.total || 0); active = Number(results[1].rows[0]?.active || 0); events = results[2].rows;
    }
    res.json({ ok: true, mcp: { endpoint: config.resource, enabled: process.env.MCP_ENABLED === 'true' && setting.enabled, deploymentEnabled: process.env.MCP_ENABLED === 'true', storageReady: present, settingsAvailable: setting.available, updatedAt: setting.updatedAt, clients: Object.entries(config.clients).map(([id, callbacks]) => ({ id, name: id === 'chatgpt' ? 'ChatGPT' : 'Claude', callbacks })), scope: MCP_SCOPE, total, active }, connections, events, offset, hasMore: offset + connections.length < total, providers: integrationProviders(), api: { origin: config.origin, authentication: 'Bearer JWT Supabase untuk API POS/admin; OAuth untuk MCP.', credentialManagement: 'Secret penyedia disimpan di environment server Vercel.', catalog: INTEGRATION_API_CATALOG, environmentSettings: 'https://vercel.com/slaks37s-projects/kasir-newhope/settings/environment-variables' } });
  }));
  app.put('/api/admin/integrations/mcp', guard('MANAGE_INTEGRATIONS'), route(async (req, res, db) => {
    if (typeof req.body?.enabled !== 'boolean' || Object.keys(req.body).some(key => !['enabled','expectedUpdatedAt','reason'].includes(key))) return res.status(400).json({ ok:false,error:'INVALID_SETTINGS' });
    if (typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 1000) return res.status(400).json({ ok:false,error:'REASON_REQUIRED' });
    if (req.body.enabled && process.env.MCP_ENABLED !== 'true') return res.status(409).json({ ok:false,error:'MCP_DEPLOYMENT_NOT_ENABLED' });
    if (req.body.enabled && (await db.query("SELECT to_regclass('mcp_private.connections') IS NOT NULL AND to_regclass('mcp_private.audit') IS NOT NULL AND to_regclass('mcp_private.credentials') IS NOT NULL AS ready")).rows[0]?.ready !== true) return res.status(409).json({ok:false,error:'MCP_STORAGE_NOT_READY'});
    const result = await db.tx(async cx => {
      await cx.query("SELECT pg_advisory_xact_lock(hashtext('admin:mcp-settings'))");
      const old = await mcpAdminSettings(cx);
      if (!old.available) return 'SETTINGS_MIGRATION_REQUIRED';
      if ((req.body.expectedUpdatedAt || null) !== old.updatedAt) return 'SETTINGS_CHANGED';
      const setting = (await cx.query(`INSERT INTO internal.platform_integrations(key,enabled,updated_by) VALUES('mcp',$1,$2) ON CONFLICT(key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp() RETURNING enabled,updated_at`, [req.body.enabled,req.internal.id])).rows[0];
      await cx.query(`INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,justification,request_id) VALUES(gen_random_uuid(),$1,$2,'MCP_SETTINGS_UPDATED','integrations/mcp',$3,$4)`, [req.internal.id, req.internal.role, String(req.body.reason).slice(0,1000), req.auditRequestId]);
      return setting;
    });
    if (typeof result === 'string') return res.status(409).json({ok:false,error:result});
    res.json({ ok:true, setting:result });
  }));
  app.post('/api/admin/integrations/mcp/connections/:id/revoke', guard('MANAGE_INTEGRATIONS'), route(async (req, res, db) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id) || typeof req.body?.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 1000) return res.status(400).json({ok:false,error:'CONNECTION_ID_AND_REASON_REQUIRED'});
    const result = await db.tx(async cx => {
      const row = (await cx.query('SELECT id,revoked_at FROM mcp_private.connections WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      if (!row) return null;
      if (!row.revoked_at) {
        await cx.query('UPDATE mcp_private.connections SET revoked_at=now() WHERE id=$1', [row.id]);
        await cx.query("INSERT INTO mcp_private.audit(connection_id,event) VALUES($1,'admin_revoked')", [row.id]);
        await cx.query(`INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,justification,request_id) VALUES(gen_random_uuid(),$1,$2,'MCP_CONNECTION_REVOKED',$3,$4,$5)`, [req.internal.id,req.internal.role,'integrations/mcp/'+row.id,String(req.body.reason).slice(0,1000),req.auditRequestId]);
      }
      return row;
    });
    if (!result) return res.status(404).json({ok:false,error:'CONNECTION_NOT_FOUND'});
    res.json({ok:true});
  }));
}
