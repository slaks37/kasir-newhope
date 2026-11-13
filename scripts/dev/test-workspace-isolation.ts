import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import type {Db} from '../../services/shared/db';
import {workspaceAcceptance} from './workspace-acceptance';
import {ownerOnboardingAcceptance} from './owner-onboarding-acceptance';
import {migrationFiles} from '../db/migration-files.mjs';

const pg=new PGlite();
const wrap=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};},exec:async sql=>{await runner.exec(sql);},tx:async fn=>pg.transaction(c=>fn(wrap(c))),close:()=>pg.close()});
const ownerGuard='migrations/0080_pos_owner_onboarding_guard.sql';
const apply=(file:string)=>pg.exec(fs.readFileSync(file,'utf8'));
try{
  await pg.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
  for(const {name} of migrationFiles())if(name!==ownerGuard)await apply(name);
  await pg.exec("INSERT INTO billing.plans(id,name,tier_level,billing_cycle,price_idr,features) VALUES('plan-pro-monthly','Synthetic',3,'MONTHLY',299000,'[]')");
  await pg.exec('SET ROLE svc_pos');
  assert.equal((await pg.query<{role:string}>('SELECT current_user AS role')).rows[0].role,'svc_pos');
  await pg.exec('RESET ROLE');
  const admin=wrap(pg),pos:Db={...admin,tx:fn=>admin.tx(async c=>{await c.exec('SET LOCAL ROLE svc_pos');return fn(c);})};
  console.log('PASS verified owner onboarding as svc_pos',await ownerOnboardingAcceptance(admin,pos,async()=>{
    await apply(ownerGuard);
    await apply(ownerGuard);
  }));
  console.log('PASS isolated workspace HTTP workflows as svc_pos',await workspaceAcceptance(admin,pos));
}finally{await pg.close();}
