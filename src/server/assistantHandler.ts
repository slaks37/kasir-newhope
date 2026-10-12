import { authenticateBearer } from '../../services/shared/auth';
import { connectDb } from '../../services/shared/db';
import { registerAssistantRoutes } from '../../services/ai/routes';
import { createServerlessBoundary } from './serverlessBoundary';

const methods: Record<string,readonly string[]> = {
  '/api/v1/assistant/consent':['GET','POST'],
  '/api/v1/assistant/query':['POST'], '/api/v1/assistant/credits':['GET'],
  '/api/v1/assistant/quick-chips':['GET'], '/api/v1/assistant/audit':['GET'],
  '/api/v1/assistant/group':['GET'],
  '/api/v1/assistant/daily-brief':['GET'],
};
/** Same verified-session boundary as sync. No unauthenticated cron or top-up. */
export function createAssistantHandler(authenticate=authenticateBearer, connect=()=>connectDb({schema:'ai',max:2})) {
  return createServerlessBoundary({
    name:'assistant',routes:methods,bodyLimit:'2mb',register:registerAssistantRoutes,
    unavailableError:'ASSISTANT_UNAVAILABLE',invalidRequestError:'INVALID_ASSISTANT_REQUEST',
  },authenticate,connect);
}
export default createAssistantHandler();
