import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';

/** Only the Auth API handles passwords, verification and signup rate limits. */
export async function registerCloudAccount(
  client: Pick<SupabaseClient, 'auth'>,
  input: { email: string; password: string; fullName: string; storeName: string; sector: string; redirectTo: string },
): Promise<{ error: AuthError | null; session: Session | null; requiresEmailConfirmation: boolean }> {
  try {
    const { data, error } = await client.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: input.redirectTo,
        data: { full_name: input.fullName, store_name: input.storeName, business_sector: input.sector },
      },
    });
    if (error) return { error, session: null, requiresEmailConfirmation: false };
    // Supabase may deliberately obscure whether an email already exists.
    // No session means check email, never successful login or an offline fallback.
    return { error: null, session: data.session, requiresEmailConfirmation: !data.session };
  } catch {
    return {
      error: { message: 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.' } as AuthError,
      session: null,
      requiresEmailConfirmation: false,
    };
  }
}
