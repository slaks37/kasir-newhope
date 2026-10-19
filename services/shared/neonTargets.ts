import restore from '../../neon/targets/full-restore.json';

/** Resource identities verified through the Neon API and reviewed with this
 * migration. Environment-supplied project/host strings cannot approve a target. */
export const neonMigrationTargets = [
  {projectId:'steep-sea-66546931',branchId:'br-icy-dust-azqi5vlc',host:'ep-damp-pine-azrnsoge.c-3.ap-southeast-1.aws.neon.tech',database:'neondb',purpose:'synthetic'},
  {...restore,purpose:'restore'},
] as const;

export function verifiedNeonTarget(env:NodeJS.ProcessEnv) {
  const target=neonMigrationTargets.find(t=>t.projectId===env.NEON_PROJECT_ID&&t.branchId===env.NEON_BRANCH_ID);
  if(!target)throw Error('BETTER_AUTH_STAGING_BRANCH_MISMATCH');
  return target;
}
