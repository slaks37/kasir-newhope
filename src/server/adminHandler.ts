import { proxyToGateway } from '../../api/_gateway';
import { releaseLatencyHandler } from './releaseLatency';
import { normalizeVercelUrl } from './vercelUrl';

export default async function handler(req: any, res: any) {
  normalizeVercelUrl(req);
  if(req.url?.split('?')[0]==='/api/admin/release-latency')return releaseLatencyHandler(req,res);
  return proxyToGateway(req, res);
}
