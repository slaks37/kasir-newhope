import {Pool} from 'pg';
import {authenticateBearer} from '../../services/shared/auth';
export default async function handler(req:any,res:any) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const principal=await authenticateBearer(req);
  if(!principal || principal.subject==='local-development') return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
  if(!process.env.DATABASE_URL) return res.status(503).json({ok:false,error:'DATABASE_UNAVAILABLE'});
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false},connectionTimeoutMillis:5000});
  try {
    const {rows}=await pool.query(`SELECT o.*,m.business_sector FROM internal.outlets o
      JOIN internal.tenants t ON t.id=o.tenant_id JOIN internal.merchants m ON m.id=o.merchant_id
      WHERE t.owner_user_ref=$1 ORDER BY o.created_at`,[principal.subject]);
    return res.status(200).json({ok:true,rows});
  } catch { return res.status(503).json({ok:false,error:'OUTLETS_UNAVAILABLE'}); }
  finally {await pool.end();}
}
