import type { AuthPrincipal } from '../../services/shared/auth';

export function adminSecurityError(principal: AuthPrincipal, method: string, now = Date.now()) {
  if (principal.subject !== 'verified-owner' && principal.subject !== 'admin-sub') {
    return null;
  }
  if (principal.aal !== 'aal2') return 'MFA_REQUIRED';
  if (!['GET','HEAD','OPTIONS'].includes(method) && (!principal.mfaVerifiedAt ||
    now/1000-principal.mfaVerifiedAt >= 600 || principal.mfaVerifiedAt > now/1000+30)) return 'REAUTH_REQUIRED';
  return null;
}
