import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {migrationFiles} from '../db/migration-files.mjs';
import type {Db} from '../../services/shared/db';
import {staffAcceptance} from './staff-acceptance';
const pg=new PGlite();
const wrap=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};},exec:async sql=>{await runner.exec(sql);},tx:fn=>pg.transaction(c=>fn(wrap(c))),close:()=>pg.close()});
try{
 for(const f of migrationFiles())await pg.exec(fs.readFileSync(f.path,'utf8'));
 await pg.exec(fs.readFileSync('migrations/0072_authenticated_staff_onboarding.sql','utf8'));
 const db=wrap(pg),pos:Db={...db,tx:fn=>db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_pos');return fn(c);})};
 console.log('PASS staff HTTP/SQL acceptance (synthetic sessions, captured email, not hosted provider/device evidence)',await staffAcceptance(db,db,pos));
 for(const role of ['svc_pos','svc_billing','svc_auth'])await assert.rejects(()=>db.tx(async c=>{await c.exec('SET LOCAL ROLE '+role);await c.query('SELECT token_hash FROM internal.staff_invitations');}),/permission denied/);
 await assert.rejects(()=>db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_staff');await c.query('SELECT pin FROM internal.memberships');}),/permission denied/);
 await assert.rejects(()=>db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_staff');await c.query('SELECT * FROM newhope_auth.session');}),/permission denied/);
 assert.equal((await db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_staff');return c.query('SELECT id FROM internal.staff_invitations');})).rows.length,0,'No tenant/hash context means no private invitations');
 await assert.rejects(()=>db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_staff');await c.query('UPDATE internal.staff_access_events SET action=action');}),/permission denied/);
 console.log('PASS staff schema replay, private invite tokens, role separation, no PIN privilege and append-only audit');
}finally{await pg.close();}
