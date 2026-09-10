import React,{useState} from 'react';
import {api,rupiah} from '../api';
import {Card,Table,Th,Td,Loading,ErrorBox,SearchBox,Pagination,SectorFilter,useAsync} from '../ui';
export default function Products({sector,onSector}:{sector:string;onSector:(s:string)=>void}){
 const [search,setSearch]=useState(''),[offset,setOffset]=useState(0);
 const {data,loading,error}=useAsync(()=>api.products({sector,search,offset,limit:50}),[sector,search,offset]);
 return <Card title="Produk terjual · data server">
  <div className="flex flex-wrap gap-3 p-4"><SearchBox placeholder="Cari produk..." value={search} onChange={v=>{setSearch(v);setOffset(0);}}/>
  <SectorFilter value={sector} onChange={v=>{onSector(v);setOffset(0);}}/></div>
  {loading&&<Loading/>}{error&&<ErrorBox error={error}/>}
  {data&&<><Table><thead><tr><Th>Produk</Th><Th>Merchant</Th><Th>Terjual</Th><Th>Omzet</Th></tr></thead>
  <tbody>{data.rows.map((p:any,i:number)=><tr key={p.product_id || i}><Td>{p.product_name}</Td><Td>{p.merchant_name}</Td><Td>{p.units_sold}</Td><Td>{rupiah(p.revenue)}</Td></tr>)}</tbody></Table>
  {!data.rows.length&&<p className="p-5 text-slate-500">Belum ada penjualan tersinkronisasi.</p>}
  <Pagination offset={offset} total={data.total} limit={50} onChange={setOffset}/></>}
 </Card>;
}
