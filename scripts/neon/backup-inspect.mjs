import fs from 'node:fs';
import {loadBackup,publicSummary} from './backup-common.mjs';
const {snapshot,ciphertextSha256}=await loadBackup(process.argv[2]);
const summary=publicSummary(snapshot,ciphertextSha256);
fs.mkdirSync('build/neon',{recursive:true});
fs.writeFileSync('build/neon/source-snapshot-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',ciphertextSha256,objectCounts:summary.objectCounts,auth:summary.auth,unsupported:snapshot.unsupported,inheritance:snapshot.inheritance,identityColumns:snapshot.tables.flatMap(t=>t.columns.filter(c=>c.identity).map(c=>t.schema+'.'+t.name+'.'+c.name)),generatedColumns:snapshot.tables.flatMap(t=>t.columns.filter(c=>c.generated).map(c=>t.schema+'.'+t.name+'.'+c.name))}));
