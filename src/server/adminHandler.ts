import { proxyToGateway } from '../../api/_gateway';
import { normalizeVercelUrl } from './vercelUrl';

export default async function handler(req: any, res: any) {
  normalizeVercelUrl(req);
  // Normalize only public blog trailing slashes before the exact API allowlist.
  // Nested or private paths still go through the existing gateway boundary.
  const url = String(req.url || ''), path = url.split('?')[0];
  if (['GET', 'HEAD'].includes(req.method) && /^\/blog(?:\/[A-Za-z0-9._~-]{1,200})?\/$/.test(path)) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.redirect(308, path.slice(0, -1) + url.slice(path.length));
  }
  return proxyToGateway(req, res);
}
