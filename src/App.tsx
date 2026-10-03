import React,{Suspense,lazy} from 'react';
import {useAuth} from './context/AuthContext';
import {useWorkspaceRoute,navigate} from './lib/navigation/workspaceRouter';
import {guardedPath,moduleForPath,pathForModule,type WorkspaceModule} from './lib/navigation/routes';
const LoginPage=lazy(()=>import('./components/auth/LoginPage').then(m=>({default:m.LoginPage})));
const HomePage=lazy(()=>import('./components/home/HomePage').then(m=>({default:m.HomePage})));
const BlogHarapanBaru=lazy(()=>import('./components/blog/BlogHarapanBaru').then(m=>({default:m.BlogHarapanBaru})));
const Workspace=lazy(()=>import('./Workspace').then(m=>({default:m.Workspace})));
const TabLoading=()=> <div className="min-h-screen grid place-items-center" role="status">Memuat halaman…</div>;

export function App() {
  const {user,loading,signOut}=useAuth();
  const route=useWorkspaceRoute(),pathname=route.split('?')[0];
  const destination=guardedPath(route,Boolean(user));
  React.useEffect(()=>{if(!loading&&destination!==route)navigate(destination,true);},[loading,destination,route]);
  const handleGoToLanding=()=>navigate('/');
  const handleOpenPOS=(targetTab?:string)=>navigate(pathForModule((targetTab||'overview') as WorkspaceModule));
  const handleLogout=async()=>{await signOut();navigate('/login',true);};
  if(loading||destination!==route)return <div className="nh-auth min-h-screen grid place-items-center" role="status">Memuat ruang kerja…</div>;
  if(!user&&(pathname==='/login'||pathname==='/register'))return <Suspense fallback={<TabLoading/>}><LoginPage onBackToLanding={handleGoToLanding} initialMode={pathname==='/register'?'register':'login'}/></Suspense>;
  if(pathname==='/blog'||pathname.startsWith('/blog/'))return <Suspense fallback={<TabLoading/>}><BlogHarapanBaru initialSlug={pathname.startsWith('/blog/')?pathname.slice(6):null} onBackToHome={handleGoToLanding} onOpenLogin={()=>navigate('/login')} onOpenRegister={()=>navigate('/register')}/></Suspense>;
  if(pathname==='/'||!moduleForPath(pathname))return <Suspense fallback={<TabLoading/>}><HomePage isStandaloneLanding={!user} onOpenLogin={()=>navigate('/login')} onOpenRegister={()=>navigate('/register')} onOpenPOS={handleOpenPOS}/></Suspense>;
  return <Suspense fallback={<TabLoading/>}><Workspace userId={user!.id} onGoToHome={handleGoToLanding} onLogout={handleLogout}/></Suspense>;
}
export default App;
