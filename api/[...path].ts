import { proxyToGateway } from './_gateway';

export default async function handler(req: any, res: any) {
  // Restore full req.url when invoked via Vercel catch-all route
  if (req.query && req.query.path) {
    const pathSegments = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    const queryString = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    req.url = `/api/${pathSegments}${queryString}`;
    req.originalUrl = req.url;
  }
  return proxyToGateway(req, res);
}
