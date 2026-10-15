import fs from 'node:fs';
import path from 'node:path';
import {privateFile,sha} from './backup-common.mjs';
import * as pgp from '../../build/neon-tools/node_modules/openpgp/dist/node/openpgp.mjs';
const expectedFingerprint='dfee9e320c8de8e0e02c90ae8451d43486628152';
const output='build/neon/private-escrow-key.asc';
const args=process.argv.slice(2),mode=args[0];
function arg(name){const i=args.indexOf(name);return i<0?null:args[i+1];}
async function password(){
 const file=arg('--passphrase-file');if(file){const s=privateFile(file).toString().trimEnd();if(s.length<20)throw Error('PASSPHRASE_MINIMUM_20_CHARACTERS');return s;}
 if(!process.stdin.isTTY)throw Error('INTERACTIVE_TTY_OR_PRIVATE_PASSPHRASE_FILE_REQUIRED');
 process.stderr.write('Passphrase escrow (minimal 20 karakter, tidak ditampilkan): ');process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
 return await new Promise((resolve,reject)=>{let value='';function input(s){for(const c of s){if(c==='\u0003'){finish();reject(Error('CANCELLED'));return;}if(c==='\r'||c==='\n'){finish();if(value.length<20)reject(Error('PASSPHRASE_MINIMUM_20_CHARACTERS'));else resolve(value);return;}if(c==='\u007f')value=value.slice(0,-1);else if(c>=' ')value+=c;}}function finish(){process.stdin.off('data',input);process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');}process.stdin.on('data',input);});
}
try{
 if(mode==='prepare'){
  if(fs.existsSync(output))throw Error('REFUSE_OVERWRITE_ESCROW_PACKAGE');
  const key=await pgp.readPrivateKey({armoredKey:privateFile('.env.neon-backup-keys.local/private.asc').toString()});if(key.getFingerprint()!==expectedFingerprint)throw Error('KEY_FINGERPRINT_MISMATCH');
  const passphrase=await password();const wrapped=await pgp.encryptKey({privateKey:key,passphrase});
  const armored=wrapped.armor();const recovered=await pgp.decryptKey({privateKey:await pgp.readPrivateKey({armoredKey:armored}),passphrase});
  if(recovered.getFingerprint()!==expectedFingerprint)throw Error('WRAP_ROUNDTRIP_FAILED');
  fs.writeFileSync(output,armored,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:'PACKAGE_PREPARED_NOT_ESCROW_ACCEPTED',path:output,fingerprint:expectedFingerprint,independentCustodyVerified:false}));
 }else if(mode==='verify'){
  const recoveredFile=arg('--recovered-key'),reference=arg('--custody-ref');if(!recoveredFile||!reference||reference.length<8)throw Error('RECOVERED_KEY_AND_CUSTODY_REFERENCE_REQUIRED');
  const recoveredPath=fs.realpathSync(recoveredFile),root=fs.realpathSync('.');if(recoveredPath===root||recoveredPath.startsWith(root+path.sep))throw Error('EXTERNAL_RECOVERED_KEY_PATH_REQUIRED');
  const wrapped=await pgp.readPrivateKey({armoredKey:privateFile(recoveredPath).toString()});if(wrapped.isDecrypted())throw Error('PASSPHRASE_ENCRYPTED_ESCROW_KEY_REQUIRED');
  const key=await pgp.decryptKey({privateKey:wrapped,passphrase:await password()});if(key.getFingerprint()!==expectedFingerprint)throw Error('KEY_FINGERPRINT_MISMATCH');
  const cipher=privateFile('build/neon/source-recovery-drive-readback.pgp.b64');const summary=JSON.parse(fs.readFileSync('build/neon/recovery-archive-summary.json'));
  if(sha(cipher)!==summary.ciphertextSha256)throw Error('BACKUP_CIPHERTEXT_MISMATCH');
  const data=JSON.parse((await pgp.decrypt({message:await pgp.readMessage({binaryMessage:Buffer.from(cipher.toString(),'base64')}),decryptionKeys:key})).data);
  if(data.format!=='newhope-pg-recovery-v1'||data.sourceProject!=='fqxrhumsgigcgjtlbfuo')throw Error('BACKUP_SCOPE_MISMATCH');
  const receipt={status:'RECOVERED_KEY_DECRYPTION_PASSED_OWNER_ACCEPTANCE_REQUIRED',checkedAt:new Date().toISOString(),fingerprint:expectedFingerprint,ciphertextSha256:sha(cipher),custodyReferenceSha256:sha(reference),nativePlatformRestoreAccepted:false,independentOwnerAcceptance:false,plaintextWritten:false};
  fs.writeFileSync('build/neon/escrow-recovery-evidence.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }else throw Error('USE_PREPARE_OR_VERIFY');
}catch(e){console.error(JSON.stringify({status:'BLOCKED',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'ESCROW_VERIFICATION_FAILED',secretsOmitted:true}));process.exitCode=2;}
