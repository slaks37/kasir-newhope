import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

type Connection = { id: string; business_id: string; client_id: string; created_at: string; expires_at: string; revoked_at: string | null };
type Overview = { endpoint: string; businesses: { business_id: string; name: string }[]; connections: Connection[];
  events: { event: string; tool: string | null; client_id: string; business_id: string; created_at: string }[] };
const button = 'rounded-xl px-4 py-3 font-semibold bg-amber-400 text-slate-950 disabled:opacity-50';
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/mcp/' + path, { method: body ? 'POST' : 'GET', signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error === 'MCP_NOT_ENABLED' ? 'MCP belum diaktifkan di server. Hubungi admin untuk menyelesaikan konfigurasi.' : data.error === 'AI_DISABLED_ON_FREE' ? 'MCP tersedia selama trial aktif atau langganan berbayar. Upgrade untuk menghubungkan kembali.' : data.error || 'Koneksi gagal. Coba lagi.');
  return data;
}

export function McpConnections({ consent = false }: { consent?: boolean }) {
  const { user, loading } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [business, setBusiness] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const client = params.get('client_id');
  const clientName = client === 'chatgpt' ? 'ChatGPT' : client === 'claude' ? 'Claude' : 'aplikasi tidak dikenal';

  useEffect(() => {
    setData(null); setBusiness(''); setError(''); setApproved(false);
    if (!user) return;
    const controller = new AbortController();
    request('manage', undefined, controller.signal).then((result: Overview) => {
      setData(result); setBusiness(result.businesses[0]?.business_id || '');
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [user?.id, revision]);

  async function decide(approve: boolean) {
    setBusy(true); setError('');
    try {
      const result = await request('consent', { ...Object.fromEntries(params), business_id: business, approve });
      // Only a same-origin server-validated callback, never the query string itself.
      window.location.assign(result.redirect);
    } catch (e) { setError(e instanceof Error ? e.message : 'Koneksi gagal'); setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError('');
    try { await request('disconnect', { id }); setRevision(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal mencabut akses'); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-slate-50 text-slate-900 p-5 sm:p-8">
    <div className="max-w-3xl mx-auto space-y-5">
      <a href="/" className="text-sm text-amber-800 underline">Kembali ke New Hope POS</a>
      <header><p className="text-xs font-bold uppercase tracking-widest text-amber-700">Integrasi aman · Read-only</p>
        <h1 className="text-3xl font-extrabold mt-2">{consent ? `Hubungkan ${clientName}` : 'Koneksi MCP'}</h1>
        <p className="text-slate-600 mt-2">Baca data usaha New Hope melalui ChatGPT atau Claude, dengan izin owner.</p></header>
      {error && <div role="alert" className="p-4 bg-rose-50 border border-rose-200 rounded-xl">{error}<button className="underline ml-3" onClick={() => setRevision(n => n + 1)}>Coba lagi</button></div>}
      {loading ? <p role="status">Memeriksa sesi…</p> : !user ? <section className="bg-white border rounded-2xl p-6 space-y-3">
        <h2 className="font-bold">Masuk sebagai owner terlebih dahulu</h2>
        <p>Buka POS dan login akun owner di tab baru, lalu kembali ke halaman ini. PIN kasir dan akun demo tidak memberi akses MCP.</p>
        <a className={button + ' inline-block'} href="/" target="_blank" rel="noopener noreferrer">Buka POS untuk login</a>
      </section> : !data && !error ? <p role="status">Memuat koneksi…</p> : data ? <>
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <p className="text-sm text-slate-600">Owner: {user.email}</p>
          {consent ? <>
            <h2 className="font-bold text-lg">Pilih bisnis yang diizinkan</h2>
            <label className="block">Bisnis<select className="block w-full border rounded-xl p-3 mt-2 bg-white" value={business} onChange={e => { setBusiness(e.target.value); setApproved(false); }}>
              {data.businesses.map(b => <option key={b.business_id} value={b.business_id}>{b.name}</option>)}</select></label>
            {!data.businesses.length && <p>Akun ini belum memiliki bisnis yang dapat dihubungkan.</p>}
            <p>{clientName} akan dapat membaca nama bisnis, produk, harga, stok, ringkasan penjualan, serta ID/tanggal/total/status transaksi bisnis terpilih. Data yang dibaca akan diterima layanan AI tersebut.</p>
            <p>Tidak termasuk data pribadi pelanggan, data staf, kunci pembayaran, atau izin mengubah transaksi. Berlaku maksimal 30 hari dan bisa dicabut kapan saja. Free tidak mendapat akses MCP.</p>
            <label className="flex gap-3 items-start"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} className="mt-1" />Saya mengizinkan data tersebut dibaca {clientName} untuk bisnis yang dipilih.</label>
            <div className="flex gap-3"><button className={button} disabled={busy || !approved || !business || !['chatgpt','claude'].includes(client || '')} onClick={() => decide(true)}>{busy ? 'Memproses…' : 'Izinkan akses baca'}</button>
              <button className="border rounded-xl px-4 py-3" disabled={busy} onClick={() => decide(false)}>Tolak</button></div>
          </> : <>
            <h2 className="font-bold text-lg">Hubungkan dari aplikasi AI</h2>
            <p>Tambahkan custom MCP connector di ChatGPT atau Claude dengan URL berikut, pilih autentikasi OAuth, lalu login dan setujui bisnis di New Hope.</p>
            <code className="block break-all p-3 rounded-xl bg-slate-50 border">{data.endpoint}</code>
            <button className={button} onClick={async () => { try { await navigator.clipboard.writeText(data.endpoint); setCopied(true); } catch { setError('Tidak bisa menyalin otomatis. Salin URL yang ditampilkan.'); } }}>{copied ? 'URL tersalin' : 'Salin URL MCP'}</button>
            <p className="text-sm text-slate-500">Ketersediaan custom connector mengikuti akun/kebijakan workspace ChatGPT dan Claude. Data yang belum tersinkron dari perangkat tidak muncul. MCP tidak menggunakan token DeepSeek/Agnes milik POS.</p>
          </>}
        </section>
        <section className="bg-white border rounded-2xl p-6 space-y-4"><h2 className="font-bold text-lg">Koneksi yang diizinkan</h2>
          {!data.connections.length && <p className="text-slate-500">Belum ada koneksi.</p>}
          {data.connections.map(c => <div className="border rounded-xl p-4 flex flex-wrap justify-between gap-3" key={c.id}>
            <div><p className="font-bold">{c.client_id === 'chatgpt' ? 'ChatGPT' : 'Claude'} · {data.businesses.find(b => b.business_id === c.business_id)?.name || c.business_id}</p>
              <p className="text-sm text-slate-500">{c.revoked_at ? 'Akses dicabut' : Date.parse(c.expires_at) <= Date.now() ? 'Kedaluwarsa' : `Izin sampai ${new Date(c.expires_at).toLocaleDateString('id-ID')}`}</p></div>
            {!c.revoked_at && Date.parse(c.expires_at) > Date.now() && <button disabled={busy} className="text-rose-700 border border-rose-200 rounded-xl px-4 py-2" onClick={() => revoke(c.id)}>Cabut akses</button>}
          </div>)}
        </section>
        <section className="bg-white border rounded-2xl p-6"><h2 className="font-bold text-lg mb-3">Aktivitas terbaru</h2>
          {!data.events.length ? <p className="text-slate-500">Belum ada aktivitas MCP.</p> : <ul className="space-y-2 text-sm">{data.events.map((e,i) => <li key={i} className="border-b py-2">{new Date(e.created_at).toLocaleString('id-ID')} · {e.client_id} · {e.event}{e.tool ? ` · ${e.tool}` : ''}</li>)}</ul>}
        </section>
      </> : null}
    </div>
  </main>;
}
