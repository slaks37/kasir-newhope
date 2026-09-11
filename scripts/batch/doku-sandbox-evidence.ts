/** Explicitly opt-in Checkout HTTP evidence. No local DB or production endpoint. */
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateDigest,generateSignature} from '../../api/_doku';

export async function captureSandboxCheckout(clientId:string,secret:string,transport:typeof fetch=fetch) {
  if(!clientId || !secret)throw new Error('SANDBOX_CREDENTIALS_REQUIRED');
  const id=randomUUID(),timestamp=new Date().toISOString().slice(0,19)+'Z';
  const target='/checkout/v1/payment',endpoint='https://api-sandbox.doku.com'+target;
  const body={order:{invoice_number:'NH-SBX-'+id,amount:10000,currency:'IDR'},payment:{payment_due_date:60}};
  const signature=generateSignature(clientId,id,timestamp,target,generateDigest(body),secret);
  let actual:any={httpStatus:null,paymentUrlPresent:false},result='NOT PASS';
  try {
    const response=await transport(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{'Content-Type':'application/json','Client-Id':clientId,'Request-Id':id,'Request-Timestamp':timestamp,Signature:signature},body:JSON.stringify(body)});
    const data=await response.json();
    actual={httpStatus:response.status,paymentUrlPresent:typeof data.response?.payment?.url==='string' && data.response.payment.url.startsWith('https://')};
    if(response.status===200 && actual.paymentUrlPresent)result='PASS';
  } catch {actual.error='NETWORK_OR_INVALID_RESPONSE';}
  return {id,executedAt:new Date().toISOString(),environment:'DOKU_SANDBOX',evidenceType:'CHECKOUT_HTTP_RESPONSE_ONLY',
    endpoint,method:'POST',request:{headers:{'Content-Type':'application/json','Client-Id':'[REDACTED]','Request-Id':id,'Request-Timestamp':timestamp,Signature:'[REDACTED]'},body},
    expected:{httpStatus:200,paymentUrlPresent:true},actual,result,
    notes:'Sanitized response projection only; payment URL/token and provider text omitted. No payment, subscription activation or ASPI test has been verified.'};
}

async function main() {
  if(!process.argv.includes('--send')) {
    console.log('NOT RUN. After DOKU confirms Checkout scope, set DOKU_SANDBOX_CLIENT_ID and DOKU_SANDBOX_SECRET_KEY, then run with --send. This creates a sandbox checkout only; no ASPI PASS or notification verification.');return;
  }
  const evidence=await captureSandboxCheckout(process.env.DOKU_SANDBOX_CLIENT_ID || '',process.env.DOKU_SANDBOX_SECRET_KEY || '');
  const directory=resolve('tmp/doku-sandbox-evidence');await mkdir(directory,{recursive:true});
  const file=resolve(directory,evidence.id+'.json');await writeFile(file,JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600});
  console.log(evidence.result+': sanitized checkout HTTP evidence saved at '+file);
  if(evidence.result!=='PASS')process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('SANDBOX_EVIDENCE_FAILED');process.exitCode=1;});
