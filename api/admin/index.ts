import { proxyToGateway } from '../_gateway';

export default async function handler(req: any, res: any) {
  return proxyToGateway(req, res);
}
