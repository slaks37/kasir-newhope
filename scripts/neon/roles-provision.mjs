import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {parse} from 'dotenv';
import pg from 'pg';
const owner=parse(fs.readFileSync('.env.neon-data-restore.local'));
const target=JSON.parse(fs.readFileSync('neon/targets/full-restore.json','utf8'));
assert.equal(target.projectId,'steep-sea-66546931');assert.equal(target.default,false);assert.equal(owner.NEON_BRANCH_ID,target.branchId);
const url=new URL(owner.NEON_RESTORE_DATABASE_URL||'');assert.equal(url.hostname.replace('-pooler',''),target.host);assert.equal(url.pathname,'/'+target.database);url.hostname=url.hostname.replace('-pooler','');
for(const k of ['sslmode','channel_binding'])url.searchParams.delete(k);assert.equal(url.search,'');
const file='.env.neon-runtime-roles.local',existing=fs.existsSync(file)?parse(fs.readFileSync(file)):null;
if(existing){assert.equal(existing.NEON_PROJECT_ID,target.projectId);assert.equal(existing.NEON_BRANCH_ID,target.branchId);}
const c=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});await c.connect();
const entries=[['DATABASE_URL','newhope_runtime_login','newhope_runtime'],['BETTER_AUTH_DATABASE_URL','newhope_auth_runtime_login','newhope_auth_runtime']];
const credentials={NEON_PROJECT_ID:target.projectId,NEON_BRANCH_ID:target.branchId,NEON_RUNTIME_ROLES_REQUIRED:'1'};
try {
  await c.query('BEGIN');
  for(const [key,login,group] of entries) {
    assert((await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[group])).rowCount,'Apply reviewed0005 before provisioning');
    const row=(await c.query('SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[login])).rows[0];
    let password;
    if(row) {
      assert(existing?.[key],'Existing role requires its previously saved credential; never rotate implicitly');
      for(const [flag,value] of Object.entries(row))assert.equal(value,flag==='rolcanlogin','Unsafe existing LOGIN role; require explicit review');
      const u=new URL(existing[key]);assert.equal(decodeURIComponent(u.username),login);password=decodeURIComponent(u.password);
    } else {
      password=randomBytes(36).toString('base64url');
      // Neon management API defaults grant neon_superuser/BYPASSRLS. Direct
      // SQL CREATE with explicit attributes creates an actually narrow role.
      await c.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password.replaceAll("'","''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`);
    }
    const memberships=(await c.query('SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname=$1)',[login])).rows;
    assert(memberships.every(r=>r.rolname===group),'Unexpected existing membership; require explicit review');
    await c.query(`GRANT ${group} TO ${login}`);
    const u=new URL('postgresql://'+target.host.replace('.c-3.','-pooler.c-3.')+'/'+target.database);u.username=login;u.password=password;u.searchParams.set('sslmode','require');credentials[key]=u.href;
  }
  // Save before COMMIT so a failed disk write cannot leave an uncaptured key.
  fs.writeFileSync(file,Object.entries(credentials).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});fs.chmodSync(file,0o600);
  await c.query('COMMIT');console.log(JSON.stringify({status:'PASS',branchId:target.branchId,logins:entries.map(v=>v[1]),file,secretPrinted:false}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
