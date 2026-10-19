import fs from 'node:fs';
import {privateFile,sha} from './backup-common.mjs';
// Owner exports existing messages as .eml. No mail is sent or message body logged.
const kind=process.argv[2],file=process.argv[3];if(!['verification','reset'].includes(kind)||!file)throw Error('USE_VERIFICATION_OR_RESET_AND_PRIVATE_EML');
const raw=privateFile(file).toString('utf8'),head=raw.split(/\r?\n\r?\n/,1)[0].replace(/\r?\n[ \t]+/g,' ');
const fields=[...head.matchAll(/^([^:\r\n]+):\s*(.*)$/gm)].map(m=>({name:m[1].toLowerCase(),value:m[2].trim()}));
if(!fields.some(f=>f.name==='from'&&/auth@kasir\.newhope\.space(?:[>\s]|$)/i.test(f.value)))throw Error('EXPECTED_SENDER_REQUIRED');
const results=fields.filter(f=>f.name==='authentication-results').map(f=>({spf:f.value.match(/\bspf=(pass|fail|softfail|neutral|none|temperror|permerror)/i)?.[1]?.toLowerCase()||'unknown',dkim:f.value.match(/\bdkim=(pass|fail|neutral|none|temperror|permerror)/i)?.[1]?.toLowerCase()||'unknown',dmarc:f.value.match(/\bdmarc=(pass|fail|bestguesspass|none|temperror|permerror)/i)?.[1]?.toLowerCase()||'unknown',fromDomain:f.value.match(/\bheader\.from=([a-z0-9.-]+)/i)?.[1]?.toLowerCase()||null,dkimDomain:f.value.match(/\bheader\.d=([a-z0-9.-]+)/i)?.[1]?.toLowerCase()||null}));
const receipt={checkedAt:new Date().toISOString(),kind,ownerExportSha256:sha(raw),authenticationResults:results,status:results.length?'OWNER_HEADER_PARSED_TRUST_BOUNDARY_REVIEW_REQUIRED':'AUTHENTICATION_RESULTS_MISSING',receiverHeaderAuthenticity:'Owner must export original from receiving mailbox; supplied headers are not independently signed attestation',spamRootCause:'NOT_ESTABLISHED_BY_PARSER',messagesSent:0};
fs.writeFileSync('build/neon/'+kind+'-header-review.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
