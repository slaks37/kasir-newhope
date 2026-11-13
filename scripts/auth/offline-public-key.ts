/** Emits only a public verification JWK. Never uploads configuration or opens DB. */
import fs from 'node:fs';
import {parse} from 'dotenv';
import {getAuthConfig} from '../../services/shared/betterAuthConfig';
import {offlineIdentityKeys} from '../../services/shared/offlineIdentity';
const env=parse(fs.readFileSync(process.argv[2]||'.env.neon-auth-staging.local'));
if(env.AUTH_PROVIDER!=='neon')throw Error('NEON_STAGING_CONFIG_REQUIRED');
const config=getAuthConfig(env);console.log(JSON.stringify(offlineIdentityKeys(config.secret,config.baseUrl).publicKey));
