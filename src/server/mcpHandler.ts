import express from 'express';
import { connectDb } from '../../services/shared/db';
import { authenticateBearer } from '../../services/shared/auth';
import { registerMcpRoutes } from '../../services/mcp/routes';

export function createMcpHandler(connect = () => connectDb({ schema: 'mcp_private', max: 2 }), authenticate = authenticateBearer) {
  let runtime: Promise<express.Express> | undefined;
  return async (req: any, res: any) => {
    if (process.env.MCP_ENABLED !== 'true') return res.status(503).json({ error: 'MCP_NOT_ENABLED' });
    try {
      runtime ??= connect().then(db => {
        const app = express();
        app.disable('x-powered-by');
        const json = express.json({ limit: '16kb' }), form = express.urlencoded({ extended: false, limit: '16kb' });
        app.use((req, res, next) => {
          if (req.body !== undefined) {
            if (typeof req.body === 'string') {
              try { req.body = req.is('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(req.body)) : JSON.parse(req.body); }
              catch { return void res.status(400).json({ error: 'invalid_request' }); }
            }
            if (JSON.stringify(req.body).length > 16384) return void res.status(413).end();
            return next();
          }
          return req.is('application/x-www-form-urlencoded') ? form(req, res, next) : json(req, res, next);
        });
        registerMcpRoutes(app, db, authenticate);
        app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
        app.use((error: any, _req: any, res: any, _next: any) => {
          if (error.type === 'entity.too.large') return void res.status(413).json({ error: 'request_too_large' });
          if (error.type === 'entity.parse.failed') return void res.status(400).json({ error: 'invalid_request' });
          const known = /^(invalid_|unsupported_|access_denied|unauthorized|rate_limited|BUSINESS_ACCESS_DENIED|AI_DISABLED_ON_FREE)/.test(error.message || '');
          res.setHeader('Cache-Control', 'no-store');
          res.status(error.message === 'unauthorized' ? 401 : error.message === 'rate_limited' ? 429 : known ? 400 : 503).json({ error: known ? error.message : 'MCP_UNAVAILABLE' });
        });
        return app;
      }).catch(error => { runtime = undefined; throw error; });
      (await runtime)(req, res);
    } catch { res.status(503).json({ error: 'MCP_UNAVAILABLE' }); }
  };
}
export default createMcpHandler();
