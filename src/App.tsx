import React,{Suspense,lazy} from 'react';
import {supabase} from './lib/supabase';
import {useAuth} from './context/AuthContext';
import {useWorkspaceRoute,navigate} from './lib/navigation/workspaceRouter';
import {guardedPath,isLandingPath,pathForModule,type WorkspaceModule} from './lib/navigation/routes';
const LoginPage=lazy(()=>import('./components/auth/LoginPage').then(m=>({default:m.LoginPage})));
const ResetPasswordPage=lazy(()=>import('./components/auth/ResetPasswordPage'));
const HomePage=lazy(()=>import('./components/home/HomePage').then(m=>({default:m.HomePage})));
const Workspace=lazy(()=>import('./Workspace').then(m=>({default:m.Workspace})));
const GrowthLinkClaim=lazy(()=>import('./components/GrowthLinkClaim'));
const TabLoading=()=> <div className="min-h-screen grid place-items-center" role="status">Memuat halaman…</div>;

export function App() {
  const {user,loading,restoreError,signOut}=useAuth();
  const [growthInvite]=React.useState(()=>{
    if(import.meta.env.VITE_GROWTH_ENGINE_ENABLED!=='1')return null;
    const supplied=new URLSearchParams(window.location.hash.slice(1)).get('growth-link');
    try{if(supplied&&/^[A-Za-z0-9_-]{43}$/.test(supplied)){sessionStorage.setItem('nh_growth_invite',supplied);return supplied;}const saved=sessionStorage.getItem('nh_growth_invite');return saved&&/^[A-Za-z0-9_-]{43}$/.test(saved)?saved:null;}catch{return supplied&&/^[A-Za-z0-9_-]{43}$/.test(supplied)?supplied:null;}
  });
  const route=useWorkspaceRoute(),pathname=route.split('?')[0];
  const destination=guardedPath(route,Boolean(user));
  React.useEffect(()=>{if(!loading&&!restoreError&&destination!==route)navigate(destination,true);},[loading,restoreError,destination,route]);
  React.useEffect(()=>{
    if(!user||import.meta.env.VITE_GROWTH_ENGINE_ENABLED!=='1')return;
    // Retry after navigation/reconnection. The server deduplicates the canonical
    // signup observation and ignores all client-authored event/subject fields.
    let cancelled=false;
    const observe=async()=>{try{const {data}=await supabase.auth.getSession();if(data.session&&!cancelled)await fetch('/api/v1/sync/growth/session',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token},signal:AbortSignal.timeout(5000)});}catch{/* Next navigation/online event retries; never affects POS. */}};
    void observe();window.addEventListener('online',observe);return()=>{cancelled=true;window.removeEventListener('online',observe);};
  },[user?.id,pathname]);
  const handleGoToLanding=()=>navigate('/');
  const handleOpenPOS=(targetTab?:string)=>navigate(pathForModule((targetTab||'overview') as WorkspaceModule));
  const handleLogout=async()=>{await signOut();navigate('/login',true);};
  if(restoreError)return <main className="nh-auth min-h-screen grid place-items-center p-6"><section className="max-w-lg space-y-4 rounded-2xl border bg-white p-6"><h1 className="text-xl font-bold">Sesi belum dapat diverifikasi</h1><p role="alert">Koneksi akun belum merespons. Data perangkat dan antrean transaksi tetap disimpan; akun tidak dipindahkan atau dihapus.</p><button className="rounded-xl bg-amber-400 px-4 py-3 font-bold" onClick={()=>window.location.reload()}>Coba hubungkan kembali</button></section></main>;
  if(user&&import.meta.env.VITE_GROWTH_ENGINE_ENABLED==='1'&&(growthInvite||new URLSearchParams(window.location.search).get('growthConsent')==='manage'))return <Suspense fallback={<TabLoading/>}><GrowthLinkClaim inviteToken={growthInvite}/></Suspense>;
  if(isLandingPath(pathname))return <Suspense fallback={<TabLoading/>}><HomePage user={user} onNavigate={navigate} isStandaloneLanding={!user} onOpenLogin={()=>navigate('/login')} onOpenRegister={()=>navigate('/register')} onOpenPOS={handleOpenPOS}/></Suspense>;
  if(loading||destination!==route)return <div className="nh-auth min-h-screen grid place-items-center" role="status">Memuat ruang kerja…</div>;
  if(pathname==='/reset-password')return <Suspense fallback={<TabLoading/>}><ResetPasswordPage/></Suspense>;
  if(!user&&(pathname==='/login'||pathname==='/register'))return <Suspense fallback={<TabLoading/>}><LoginPage onBackToLanding={handleGoToLanding} initialMode={pathname==='/register'?'register':'login'}/></Suspense>;
  // The blog is server-rendered (src/server/blogPages.ts); a client-side visit (old #blog links) loads the real page.
  if(pathname==='/blog'||pathname.startsWith('/blog/'))return <BlogRedirect path={route}/>;
  return <Suspense fallback={<TabLoading/>}><Workspace userId={user!.id} onGoToHome={handleGoToLanding} onLogout={handleLogout}/></Suspense>;
}
/** One full-page hop to the server-rendered blog; a second arrival here (no server route, e.g. offline) shows a link instead of looping. */
function BlogRedirect({path}:{path:string}){
  const [looped]=React.useState(()=>{try{return sessionStorage.getItem('nh_blog_hop')===path;}catch{return true;}});
  React.useEffect(()=>{if(looped)return;try{sessionStorage.setItem('nh_blog_hop',path);}catch{}window.location.replace(path);},[looped,path]);
  return <div className="min-h-screen grid place-items-center" role="status">{looped?<a href={path}>Buka blog</a>:'Membuka blog…'}</div>;
}
export default App;
