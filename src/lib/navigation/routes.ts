export const workspaceRoutes = {
  overview:'/overview',pos:'/pos',tables:'/tables',inventory:'/inventory',customers:'/customers',
  reports:'/reports',ai:'/ai',labor:'/labor',settings:'/settings',payment:'/subscription',businesses:'/businesses',
} as const;
export type WorkspaceModule = keyof typeof workspaceRoutes;
export function moduleForPath(path:string):WorkspaceModule|null {
  return (Object.keys(workspaceRoutes) as WorkspaceModule[]).find(key=>workspaceRoutes[key]===path.replace(/\/$/,''))||null;
}
export function pathForModule(module:WorkspaceModule|'home'):string {
  return module==='home'?workspaceRoutes.overview:workspaceRoutes[module]||workspaceRoutes.overview;
}
/** Only same-origin workspace paths may be restored after authentication. */
export function safeReturnPath(value:string|null):string {
  if(!value||!value.startsWith('/')||value.startsWith('//'))return '/overview';
  const path=value.split(/[?#]/)[0];return moduleForPath(path)?value:'/overview';
}
export function legacyHashPath(hash:string):string|null {
  const value=hash.replace(/^#/,'');
  if(value==='home'||value==='landing')return '/';
  if(value==='login'||value==='register')return '/'+value;
  if(value==='payment')return '/subscription';
  if(value==='blog'||value.startsWith('blog/'))return '/'+value;
  return moduleForPath('/'+value)?'/'+value:null;
}
export function guardedPath(path:string,authenticated:boolean):string {
  if(!authenticated&&moduleForPath(path.split('?')[0]))return '/login?returnTo='+encodeURIComponent(path);
  if(authenticated&&['/login','/register'].includes(path.split('?')[0])) {
    return safeReturnPath(new URLSearchParams(path.split('?')[1]||'').get('returnTo'));
  }
  return path;
}
