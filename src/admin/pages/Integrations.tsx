import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Card, Chip, ErrorBox, Loading } from '../ui';

type Connection = { id:string; business_name:string; business_id:string; client_id:string; connected:boolean; created_at:string; expires_at:string; revoked_at:string|null; last_used_at:string|null };
type Inventory = {
  mcp:{endpoint:string;enabled:boolean;deploymentEnabled:boolean;storageReady:boolean;settingsAvailable:boolean;updatedAt:string|null;scope:string;total:number;active:number;clients:Array<{id:string;name:string;callbacks:string[]}>};
  connections:Connection[];hasMore:boolean;
  events:Array<{event:string;tool:string|null;created_at:string;client_id:string;business_id:string}>;
  providers:Array<{id:string;name:string;purpose:string;configured:boolean;dashboard:string;note:string}>;
  api:{origin:string;authentication:string;credentialManagement:string;environmentSettings:string;catalog:Array<{method:string;path:string;auth:string;purpose:string}>};
};
const button='rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed';
const date=(v:string|null)=>v?new Date(v).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}):'Belum ada';
const state=(c:Connection)=>c.revoked_at?'Dicabut':Date.parse(c.expires_at)<=Date.now()?'Kedaluwarsa':c.connected?'Terhubung':'Menunggu OAuth';

export default function Integrations(){
  const [data,setData]=useState<Inventory|null>(null),[error,setError]=useState<Error|null>(null);
  const [tab,setTab]=useState<'mcp'|'api'|'providers'|'activity'>('mcp');
  const [offset,setOffset]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [reason,setReason]=useState(''),[revoke,setRevoke]=useState<string|null>(null),[notice,setNotice]=useState('');
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const id=++generation.current;setLoading(true);setError(null);
    try {const result=await api.integrations(offset);if(id===generation.current)setData(result as Inventory);}
    catch(e){if(id===generation.current)setError(e instanceof Error?e:new Error('Gagal memuat integrasi.'));}
    finally{if(id===generation.current)setLoading(false);}
  },[offset]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
  async function mutate(fn:()=>Promise<unknown>){
    setBusy(true);setError(null);setNotice('');
    try{await fn();setReason('');setRevoke(null);setNotice('Perubahan tersimpan dan tercatat di audit.');await refresh();}
    catch(e){setError(e instanceof Error?e:new Error('Perubahan gagal.'));}
    finally{setBusy(false);}
  }
  async function copy(value:string){
    try{await navigator.clipboard.writeText(value);setNotice('Endpoint disalin.');}
    catch{setNotice('Tidak dapat menyalin otomatis. Pilih dan salin alamat endpoint yang ditampilkan.');}
  }
  return <div className="space-y-5">
    <Card title="Integrasi, API & MCP" subtitle="Pusat pengaturan koneksi platform. Hanya Superadmin; tindakan sensitif memerlukan MFA baru." actions={<button className={button} disabled={loading||busy} onClick={()=>void refresh()}>Muat ulang</button>}>
      <nav className="flex flex-wrap gap-2 p-4" aria-label="Bagian integrasi">{(['mcp','api','providers','activity'] as const).map(t=><button key={t} aria-pressed={tab===t} className={`${button} ${tab===t?'bg-amber-100 border-amber-300':''}`} onClick={()=>{setTab(t);setRevoke(null);setReason('');}}>{{mcp:'MCP & koneksi',api:'API & autentikasi',providers:'Connector layanan',activity:'Aktivitas MCP'}[t]}</button>)}</nav>
    </Card>
    {error&&<ErrorBox error={error}/>}{notice&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-slate-800">{notice}</p>}
    {loading&&<Loading/>}
    {data&&!loading&&tab==='mcp'&&<>
      <Card title="Layanan MCP" subtitle="ChatGPT dan Claude membaca data hanya setelah persetujuan OAuth owner; tidak dapat menulis transaksi.">
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3"><Chip>{data.mcp.enabled?'Layanan aktif':'Layanan dijeda'}</Chip><span className="text-sm text-slate-600">Scope: {data.mcp.scope} · {data.mcp.active} izin aktif · {data.mcp.total} izin tercatat</span></div>
          <div className="flex flex-wrap gap-3 items-center"><code className="break-all text-sm">{data.mcp.endpoint}</code><button className={button} onClick={()=>void copy(data.mcp.endpoint)}>Salin endpoint</button></div>
          {!data.mcp.deploymentEnabled&&<p className="text-sm text-amber-800">MCP_ENABLED belum aktif di deployment. Aktifkan melalui pengaturan server terlebih dahulu.</p>}
          {!data.mcp.storageReady&&<p className="text-sm text-amber-800">Penyimpanan MCP belum tersedia; koneksi belum siap.</p>}
          <label className="block text-sm font-bold">Alasan perubahan layanan<input className="mt-2 w-full rounded-xl border border-slate-200 p-3 font-normal" value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} placeholder="Contoh: pemeliharaan koneksi MCP"/></label>
          <button className={`${button} bg-amber-100`} disabled={busy||!reason.trim()||!data.mcp.settingsAvailable||(!data.mcp.enabled&&(!data.mcp.deploymentEnabled||!data.mcp.storageReady))} onClick={()=>void mutate(()=>api.updateMcpSettings({enabled:!data.mcp.enabled,expectedUpdatedAt:data.mcp.updatedAt,reason}))}>{data.mcp.enabled?'Jeda layanan MCP':'Aktifkan layanan MCP'}</button>
          <p className="text-xs text-slate-500">Jeda menghentikan akses tools dan koneksi baru, bukan menghapus izin. Owner tetap dapat mencabut koneksinya. Perubahan terakhir: {date(data.mcp.updatedAt)} WIB.</p>
          <details><summary className="cursor-pointer text-sm font-bold">Client OAuth yang diizinkan</summary>{data.mcp.clients.map(c=><div className="mt-3 text-sm" key={c.id}><strong>{c.name}</strong>{c.callbacks.map(u=><code className="block break-all text-xs mt-1" key={u}>{u}</code>)}</div>)}</details>
        </div>
      </Card>
      <Card title="Koneksi owner" subtitle="Terhubung berarti token OAuth pernah diterbitkan. Waktu pemakaian berasal dari audit pembacaan tools.">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{['Bisnis','Client','Status','Pemakaian terakhir (WIB)','Aksi'].map(h=><th className="p-4" key={h}>{h}</th>)}</tr></thead><tbody>{data.connections.map(c=><tr key={c.id} className="border-t border-slate-100"><td className="p-4"><p className="font-bold">{c.business_name}</p><p className="text-xs text-slate-500 break-all">{c.id}</p></td><td className="p-4">{c.client_id}</td><td className="p-4"><Chip>{state(c)}</Chip></td><td className="p-4">{date(c.last_used_at)}</td><td className="p-4"><button className={button} disabled={busy||!!c.revoked_at} onClick={()=>{setRevoke(c.id);setReason('');}}>Cabut akses</button></td></tr>)}</tbody></table></div>
        {!data.connections.length&&<p className="p-5 text-sm text-slate-500">Belum ada koneksi owner yang tercatat. Tidak ada connector yang dihubungkan otomatis.</p>}
        {revoke&&<div className="m-5 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3"><p className="font-bold text-sm">Cabut akses koneksi {revoke}?</p><p className="text-sm">Token koneksi ini akan ditolak. Data POS tetap tersimpan.</p><input aria-label="Alasan pencabutan" value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} placeholder="Alasan pencabutan wajib diisi" className="w-full rounded-xl border border-slate-200 p-3"/><button className={button} disabled={busy||!reason.trim()} onClick={()=>void mutate(()=>api.revokeMcpConnection(revoke,reason))}>Konfirmasi cabut akses</button> <button className={button} disabled={busy} onClick={()=>setRevoke(null)}>Batal</button></div>}
        <div className="flex justify-between p-4"><button className={button} disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Sebelumnya</button><button className={button} disabled={busy||!data.hasMore} onClick={()=>setOffset(offset+50)}>Berikutnya</button></div>
      </Card>
    </>}
    {data&&!loading&&tab==='api'&&<Card title="API platform" subtitle={data.api.authentication}><div className="p-5 space-y-4"><p className="text-sm">{data.api.credentialManagement} API POS menggunakan sesi akun, bukan API key global yang membuka semua merchant.</p><a className="inline-block text-sm font-bold underline" href={data.api.environmentSettings} target="_blank" rel="noreferrer">Kelola secret server di Vercel</a><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Endpoint','Akses','Kegunaan'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data.api.catalog.map(c=><tr className="border-t border-slate-100" key={c.path}><td className="p-3"><code className="break-all">{c.method} {c.path}</code><button className="block text-xs underline mt-2" onClick={()=>void copy(data.api.origin+c.path)}>Salin URL</button></td><td className="p-3">{c.auth}</td><td className="p-3">{c.purpose}</td></tr>)}</tbody></table></div></div></Card>}
    {data&&!loading&&tab==='providers'&&<div className="grid gap-4 md:grid-cols-2">{data.providers.map(p=><Card key={p.id} title={p.name} subtitle={p.purpose}><div className="space-y-3 p-5"><Chip>{p.configured?'Konfigurasi tersedia':'Belum dikonfigurasi'}</Chip><p className="text-sm text-slate-600">{p.note}</p><p className="text-xs text-slate-500">Ini bukan hasil uji koneksi. Nilai secret tidak ditampilkan.</p><a href={p.dashboard} target="_blank" rel="noreferrer" className="text-sm font-bold underline">Buka dashboard {p.name}</a></div></Card>)}</div>}
    {data&&!loading&&tab==='activity'&&<Card title="Aktivitas MCP terbaru" subtitle="30 kejadian terbaru. Audit tindakan admin tersedia di Jejak Akses."><div className="p-5 space-y-3">{data.events.map((e,i)=><div key={`${e.created_at}-${i}`} className="border-b border-slate-100 pb-3 text-sm"><p className="font-bold">{e.event}{e.tool?' · '+e.tool:''}</p><p className="text-slate-500">{e.client_id} · {e.business_id} · {date(e.created_at)} WIB</p></div>)}{!data.events.length&&<p className="text-sm text-slate-500">Belum ada aktivitas MCP.</p>}</div></Card>}
  </div>;
}
