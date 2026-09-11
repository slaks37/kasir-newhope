import React,{useState} from 'react';
import {api,waktu} from '../api';
import {Card,Table,Th,Td,Loading,ErrorBox,SearchBox,useAsync} from '../ui';
export default function Audit(){
 const [search,setSearch]=useState('');
 const {data,loading,error}=useAsync(()=>api.audit(),[]);
 const rows=(data?.rows || []).filter((r:any)=>[r.internal_email,r.internal_name,r.action,r.resource,r.justification,r.request_id].join(' ').toLowerCase().includes(search.toLowerCase()));
 return <Card title="Audit akses internal · 200 entri terbaru">
 <p className="p-4 text-sm text-slate-500">Akses sensitif dan penolakan izin dicatat server. Hasil tindakan operasional beserta nilai sebelum/sesudah disimpan dalam riwayat support tenant.</p>
 <div className="p-4"><SearchBox value={search} onChange={setSearch} placeholder="Cari operator, aksi, atau alasan…"/></div>
 {loading&&<Loading/>}{error&&<ErrorBox error={error}/>}
 <div className="overflow-x-auto"><Table><thead><tr><Th>Waktu</Th><Th>Operator</Th><Th>Aksi / objek</Th><Th>Alasan</Th></tr></thead><tbody>
 {rows.map((r:any)=><tr key={r.id}><Td>{waktu(r.accessed_at)}</Td><Td>{r.internal_email}<br/><small>{r.internal_role}</small></Td><Td>{r.action}<br/><small>{r.resource}</small><details><summary>Detail request</summary><p className="break-all">ID: {r.request_id || 'Log lama'}<br/>IP koneksi: {r.ip_address || '—'}<br/>User-agent: {r.user_agent || '—'}</p></details></Td><Td>{r.justification || '—'}</Td></tr>)}
 </tbody></Table></div>{!loading&&!rows.length&&<p className="p-5">Belum ada log yang cocok.</p>}
 </Card>;
}
