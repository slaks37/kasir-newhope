import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parse} from 'dotenv';
import {connectDb} from '../../services/shared/db';
import {pastikanPaket} from '../../services/billing/store';
import {SAAS_PLANS} from '../../src/config/saasPlans';
const target=process.argv[2];assert(['staging','production'].includes(target));
if(target==='production')assert.equal(process.env.FULL_NEON_CONFIG_PRODUCTION_APPROVED,'OWNER_CLEAN_START_2026_10_22');
Object.assign(process.env,parse(fs.readFileSync('.env.full-neon-'+target+'.local')));assert.equal(process.env.FULL_NEON_TARGET,target);
const db=await connectDb({schema:'billing',max:1});
try{await db.tx(c=>pastikanPaket(c,SAAS_PLANS));console.log(JSON.stringify({status:'PASS',target,seededOnly:'canonical plan configuration',plans:SAAS_PLANS.map(p=>p.id),businessAccountsCreated:0}));}finally{await db.close();}
