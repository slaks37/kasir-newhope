/** Excluded legacy authentication implementation in a Neon-only build. */
export const supabase={get auth():never{throw Error('LEGACY_AUTH_DISABLED');}};
export const isSupabaseConfigured=false;
export async function legacyNativeGoogleLogin():Promise<{error:Error|null}>{throw Error('LEGACY_AUTH_DISABLED');}
