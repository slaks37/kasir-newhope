import { ownedSubscription } from './free-plan';
export default async function handler(req:any,res:any) { return ownedSubscription(req,res); }
