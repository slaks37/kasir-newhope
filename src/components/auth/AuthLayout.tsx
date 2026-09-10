import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ChartNoAxesCombined, ShieldCheck, ShoppingBag, Store } from 'lucide-react';
import { Brand } from '../brand/Brand';

interface AuthLayoutProps {
  children: ReactNode;
  admin?: boolean;
  register?: boolean;
  onBack?: () => void;
}

export function AuthLayout({ children, admin = false, register = false, onBack }: AuthLayoutProps) {
  return (
    <div className="nh-auth">
      <header className="nh-auth-header">
        <a href="/" aria-label="New Hope POS — halaman utama"><Brand admin={admin} /></a>
        {onBack ? <button onClick={onBack} className="nh-text-link"><ArrowLeft size={16} /> Halaman utama</button> : <a href="/" className="nh-text-link"><ArrowLeft size={16} /> Halaman utama</a>}
      </header>
      <main className="nh-auth-main">
        <aside className="nh-auth-story">
          <span className="nh-eyebrow"><span />{admin ? 'KENDALI PLATFORM' : 'USAHA HEBAT DIMULAI DI SINI'}</span>
          <h2>{admin ? <>Perspektif menyeluruh.<br /><em>Kendali yang terarah.</em></> : register ? <>Satu langkah awal.<br /><em>Banyak peluang baru.</em></> : <>Selamat datang kembali.<br /><em>Siap tumbuh lagi?</em></>}</h2>
          <p>{admin ? 'Ruang kerja terpusat untuk memantau merchant, meninjau transaksi, dan mengelola akses tim.' : 'Dari transaksi pertama hingga keputusan berikutnya. Kelola operasional usaha dengan lebih rapi, dalam satu ruang kerja.'}</p>
          <div className="nh-auth-illustration" aria-hidden="true">
            <div className="nh-story-top"><span><Store size={18} /> {admin ? 'Platform workspace' : 'Your business workspace'}</span><ArrowUpRight size={18} /></div>
            <div className="nh-story-title">{admin ? 'Satu pandangan. Lebih terarah.' : 'Lebih tertata. Lebih bermakna.'}</div>
            <div className="nh-story-flow">
              <span><ShoppingBag size={21} /><b>{admin ? 'Merchant' : 'Transaksi'}</b><small>{admin ? 'Pantau operasional' : 'Layani pelanggan'}</small></span>
              <span><ChartNoAxesCombined size={21} /><b>Ringkasan</b><small>Pahami performa</small></span>
              <span><ShieldCheck size={21} /><b>{admin ? 'Hak akses' : 'Kontrol usaha'}</b><small>{admin ? 'Sesuai peran tim' : 'Ambil keputusan'}</small></span>
            </div>
          </div>
          <div className="nh-auth-benefits"><span><Check size={15} /> {admin ? 'Akses sesuai kewenangan' : 'Untuk berbagai jenis usaha'}</span><span><Check size={15} /> {admin ? 'Jejak aktivitas terpusat' : 'Nyaman di berbagai perangkat'}</span></div>
        </aside>
        <section className="nh-auth-card">{children}</section>
      </main>
      <footer className="nh-auth-footer"><span>© {new Date().getFullYear()} New Hope POS</span><span>{admin ? 'Portal khusus administrator yang berwenang.' : 'Usaha Anda, harapan baru setiap hari.'}</span></footer>
    </div>
  );
}
