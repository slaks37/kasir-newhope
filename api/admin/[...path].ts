/**
 * Semua route konsol penyedia diteruskan ke gateway kanonik.
 *
 * Tanpa berkas ini, /api/admin/* menghasilkan 404 di deployment Vercel — dan
 * sejak identitas konsol dijawab server, 404 itu berarti tidak ada yang bisa
 * masuk sama sekali. Membutuhkan GATEWAY_URL.
 */
import { proxyToGateway } from '../_gateway';

export default proxyToGateway;
