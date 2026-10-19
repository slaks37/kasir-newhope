/** Public article GETs are business writers too. Keep Preview observations and
 * an explicitly paused migration window read-only without changing content. */
export function blogViewTrackingEnabled(env=process.env):boolean {
 if(env.BUSINESS_WRITES_PAUSED==='1'||env.NEON_DB_PHASE1==='1'&&env.HYBRID_STAGING==='1')return false;
 return env.BLOG_VIEW_TRACKING_ENABLED===undefined||env.BLOG_VIEW_TRACKING_ENABLED.trim()==='1';
}
