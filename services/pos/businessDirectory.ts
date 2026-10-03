import type {Express} from 'express';
import type {Db} from '../shared/db';
import {tenantForPrincipal,trustedPrincipal} from '../shared/auth';

/** Canonical identity directory. Sector is a label, never a grouping key. */
export function registerBusinessDirectory(app:Express,db:Db){
  app.get('/api/v1/sync/business',async(req,res)=>{
    const principal=trustedPrincipal(req);
    if(!principal)return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
    try{
      const tenantId=await tenantForPrincipal(db,principal);
      if(!tenantId)return res.json({ok:true,tenantId:null,businesses:[]});
      const result=await db.query(`SELECT m.id,m.tenant_id,m.name,m.business_sector,m.is_active,m.external_ref,
        o.id AS outlet_id,o.name AS outlet_name,o.address,o.is_active AS outlet_active,o.latitude,o.longitude,o.radius_meters
        FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
        LEFT JOIN internal.outlets o ON o.merchant_id=m.id AND o.tenant_id=m.tenant_id
        WHERE m.tenant_id=$1 AND t.owner_user_ref=$2 AND t.merged_into IS NULL AND t.is_active
        ORDER BY m.created_at,m.id,o.created_at,o.id`,[tenantId,principal.subject]);
      const capabilities=(await db.query("SELECT 1 FROM pg_constraint WHERE conrelid='pos.shared_state_records'::regclass AND conname='shared_state_business_namespace'")).rows.length>0;
      const businesses=new Map<string,{businessId:string;tenantId:string;name:string;sector:string;status:string;legacyAlias:string|null;transportRef:string|null;outlets:Array<{outletId:string;businessId:string;name:string;address:string;status:string}>}>();
      for(const row of result.rows){
        let business=businesses.get(row.id);
        if(!business){business={businessId:row.id,tenantId:row.tenant_id,name:row.name,sector:row.business_sector,
          status:row.is_active?'ACTIVE':'INACTIVE',
          legacyAlias:row.external_ref===`${principal.subject}_${row.business_sector}`?row.external_ref:null,transportRef:row.external_ref||row.id,outlets:[]};businesses.set(row.id,business);}
        if(row.outlet_id)business.outlets.push({outletId:row.outlet_id,businessId:row.id,name:row.outlet_name,address:row.address||'',status:row.outlet_active?'ACTIVE':'INACTIVE',
          ...{latitude:row.latitude===null?null:Number(row.latitude),longitude:row.longitude===null?null:Number(row.longitude),radiusMeters:row.radius_meters===null?null:Number(row.radius_meters)}});
      }
      return res.json({ok:true,tenantId,capabilities:{multiBusiness:capabilities},businesses:[...businesses.values()]});
    }catch{return res.status(503).json({ok:false,error:'BUSINESS_DIRECTORY_UNAVAILABLE'});}
  });
}
