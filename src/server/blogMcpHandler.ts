import express from 'express';
import { connectDb } from '../../services/shared/db';
import { authenticateBearer } from '../../services/shared/auth';
import { registerBlogMcpRoutes } from '../../services/blog-mcp/routes';
import { normalizeVercelUrl } from './vercelUrl';

/** OAuth editorial has its own credentials, audience and HTTP boundary. */
export function createBlogMcpHandler(connect = () => connectDb({ schema: 'blog_mcp_private', max: 2 }), authenticate = authenticateBearer) {
  let runtime: Promise<express.Express> | undefined;
  return async (req: any, res: any) => {
    normalizeVercelUrl(req);
    res.setHeader('Cache-Control', 'no-store');
    if (process.env.BLOG_MCP_ENABLED === 'false') return res.status(503).json({ error: 'BLOG_MCP_DISABLED' });
    try {
      runtime ??= connect().then(db => {
        const app = express();
        app.disable('x-powered-by');
        const json = express.json({ limit: '768kb' }), form = express.urlencoded({ extended: false, limit: '16kb' });
        app.use((req, res, next) => {
          if (req.body !== undefined) {
            if (typeof req.body === 'string') {
              try { req.body = req.is('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(req.body)) : JSON.parse(req.body); }
              catch { return void res.status(400).json({ error: 'invalid_request' }); }
            }
            if (JSON.stringify(req.body).length > 768 * 1024) return void res.status(413).end();
            return next();
          }
          return req.is('application/x-www-form-urlencoded') ? form(req, res, next) : json(req, res, next);
        });
        registerBlogMcpRoutes(app, db, authenticate);
        app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
        app.use((error: any, _req: any, res: any, _next: any) => {
          if (error.type === 'entity.too.large') return void res.status(413).json({ error: 'request_too_large' });
          if (error.type === 'entity.parse.failed') return void res.status(400).json({ error: 'invalid_request' });
          const message = String(error.message || '');
          const known = /^(invalid_|unsupported_|access_denied|unauthorized|rate_limited|MFA_REQUIRED|REAUTH_REQUIRED)$/.test(message)
            || /^(invalid_|unsupported_)/.test(message);
          const status = message === 'unauthorized' ? 401 : ['access_denied','MFA_REQUIRED','REAUTH_REQUIRED'].includes(message) ? 403 : message === 'rate_limited' ? 429 : known ? 400 : 503;
          res.status(status).json({ error: known ? message : 'BLOG_MCP_UNAVAILABLE' });
        });
        return app;
      }).catch(error => { runtime = undefined; throw error; });
      (await runtime)(req, res);
    } catch { res.status(503).json({ error: 'BLOG_MCP_UNAVAILABLE' }); }
  };
}
export default createBlogMcpHandler();
