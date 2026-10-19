import {getBetterAuthRuntime} from './betterAuth';
import {betterAuthPilotConfig} from './betterAuthPilot';

/** Canonical ID binding, never an email match or caller-supplied auth ID. */
export async function betterOwnerIdentity(subject:string) {
  if(!/^[0-9a-f-]{36}$/i.test(subject))return null;
  const {pool}=getBetterAuthRuntime();
  const row=(await pool.query(`SELECT u.email,u."emailVerified" AS verified
    FROM internal.auth_identity_bindings b
    JOIN internal.users c ON c.id=b.canonical_user_id AND c.is_active
    JOIN newhope_auth."user" u ON u.id=b.provider_subject AND u."isActive"
    WHERE b.provider='better-auth' AND b.issuer=$1 AND b.canonical_user_id=$2 AND b.is_active`,[betterAuthPilotConfig().baseUrl,subject])).rows[0];
  return row?{email:row.email as string,verified:row.verified===true}:null;
}
