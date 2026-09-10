import React,{useState} from 'react';
import {api,rupiah,tanggal} from '../api';
import {Card,Table,Th,Td,Loading,ErrorBox,SearchBox,useAsync} from '../ui';
export default function StaffCommissions(){
 const [search,setSearch]=useState('');
 const {data,loading,error}=useAsync(()=>api.staffCommissions({search}),[search]);
 return <Card title="Ledger komisi staf · 200 entri terbaru">
 <p className="text-sm text-slate-500 p-4">Nilai dan status berasal dari ledger merchant. Halaman ini tidak mengubah persetujuan atau pencairan komisi.</p>
 <div className="p-4"><SearchBox value={search} onChange={setSearch} placeholder="Cari staf atau merchant…"/></div>
 {loading&&<Loading/>}{error&&<ErrorBox error={error}/>}
 {data&&<Table><thead><tr><Th>Staf</Th><Th>Merchant / outlet</Th><Th>Struk</Th><Th>Komisi</Th><Th>Status</Th></tr></thead>
 <tbody>{data.rows.map((r:any)=><tr key={r.commission_id}><Td>{r.staff_name}</Td><Td>{r.merchant_name} / {r.outlet_name}</Td><Td>{r.invoice_number}<br/>{tanggal(r.created_at)}</Td><Td>{rupiah(r.commission_amount)}</Td><Td>{r.commission_status}</Td></tr>)}</tbody></Table>}
 {data&&!data.rows.length&&<p className="p-5 text-slate-500">Belum ada komisi tercatat.</p>}
 </Card>;
}
