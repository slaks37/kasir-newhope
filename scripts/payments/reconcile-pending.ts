// No automatic run or production activation. Defaults to database-free refusal.
import {connectDb} from '../../services/shared/db';
import {isDokuConfigured} from '../../api/_doku';
import {recoverPendingPayments} from '../../services/billing/recovery';
if(!process.argv.includes('--apply')||process.env.DOKU_RECOVERY_CONFIRM!=='SUBSCRIPTION_STATUS_INQUIRY')throw Error('EXPLICIT_RECOVERY_APPROVAL_REQUIRED');
if(!process.env.DATABASE_URL||!isDokuConfigured())throw Error('PRIVATE_DATABASE_AND_DOKU_CONFIGURATION_REQUIRED');
const u=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(u.hostname)&&u.searchParams.get('sslmode')!=='verify-full'&&!process.env.PGSSLROOTCERT)throw Error('VERIFIED_DATABASE_TLS_REQUIRED');
const db=await connectDb({schema:'billing',max:2});
try{console.log(JSON.stringify(await recoverPendingPayments(db)));}finally{await db.close();}
