import { proxyToGateway } from '../../api/_gateway';
import { normalizeVercelUrl } from './vercelUrl';

export default async function handler(req: any, res: any) {
  normalizeVercelUrl(req);
  return proxyToGateway(req, res);
}
