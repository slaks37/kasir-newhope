import { proxyToGateway } from '../../api/_gateway';

export default async function handler(req: any, res: any) {
  return proxyToGateway(req, res);
}
