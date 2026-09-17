import { ownedSubscription } from './free-plan';
// Trial is provisioned once on verified signup. This endpoint cannot reset its clock.
export default async function handler(req:any,res:any) {
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  return ownedSubscription({...req,method:'GET',headers:req.headers},res);
}
