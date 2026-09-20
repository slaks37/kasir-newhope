import '../shared/env';
import { startService, PORTS } from '../shared/service';
import { registerAssistantRoutes } from './routes';
startService({name:'ai',port:PORTS.ai,schema:'ai',register:(app,svc)=>registerAssistantRoutes(app,svc.db)});
