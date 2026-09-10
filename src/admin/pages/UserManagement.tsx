import React from 'react';
import {api,ROLE_LABEL} from '../api';
import {Card,Table,Th,Td,Loading,ErrorBox,useAsync} from '../ui';
export default function UserManagement(){
 const {data,loading,error}=useAsync(()=>api.identities(),[]);
 return <Card title="Keanggotaan admin terverifikasi"><p className="p-4 text-sm text-slate-600">Role berasal dari server dan terikat pada ID pengguna Supabase. Penambahan akses harus melalui provisioning operator, bukan akun merchant atau localStorage.</p>
 {loading&&<Loading/>}{error&&<ErrorBox error={error}/>}
 {data&&<Table><thead><tr><Th>Nama</Th><Th>Email</Th><Th>Role</Th></tr></thead><tbody>{data.identities.map(u=><tr key={u.email}><Td>{u.full_name}</Td><Td>{u.email}</Td><Td>{ROLE_LABEL[u.role]}</Td></tr>)}</tbody></Table>}
 </Card>;
}
