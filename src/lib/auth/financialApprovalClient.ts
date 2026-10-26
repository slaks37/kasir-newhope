import type {BusinessSector} from '../../types';
export type ApprovalRequest={businessId?:string;moduleId?:string;sector:BusinessSector;outletId:string;action:'VOID'|'REFUND'|'CASH_OUT'|'CASH_REVERSE';reference:string;reason:string;command:unknown};
export async function financeRequest(path:string,body:unknown){
  const response=await fetch('/api/v1/finance/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.ok)throw new Error(data?.error||'FINANCIAL_AUTHORIZATION_UNAVAILABLE');
  return data;
}
/** PIN stays in memory for a single HTTPS request, never browser storage/outbox. */
function ownerPin():Promise<string>{
  return new Promise((resolve,reject)=>{
    const dialog=document.createElement('dialog');
    dialog.style.cssText='border:1px solid #cbd5e1;border-radius:16px;padding:24px;max-width:360px;width:90%;';
    const title=document.createElement('h2');title.textContent='Persetujuan finansial pemilik';
    const note=document.createElement('p');note.textContent='Masukkan PIN finansial server (4–8 digit). Buat PIN di Pengaturan pengguna jika belum tersedia. Tindakan ini memerlukan koneksi internet.';
    const input=document.createElement('input');input.type='password';input.inputMode='numeric';input.maxLength=8;input.minLength=4;input.autocomplete='off';input.setAttribute('aria-label','PIN finansial pemilik');
    input.style.cssText='display:block;width:100%;padding:12px;margin:16px 0;border:1px solid #94a3b8;';
    const approve=document.createElement('button');approve.textContent='Setujui';approve.type='button';
    const cancel=document.createElement('button');cancel.textContent='Batal';cancel.type='button';cancel.style.marginLeft='16px';
    const stop=()=>{input.value='';dialog.close();dialog.remove();};
    const submit=()=>{if(!/^\d{4,8}$/.test(input.value)){input.setCustomValidity('Masukkan 4–8 digit');input.reportValidity();return;}const pin=input.value;stop();resolve(pin);};
    approve.onclick=submit;cancel.onclick=()=>{stop();reject(new Error('Persetujuan dibatalkan'));};
    dialog.addEventListener('cancel',e=>{e.preventDefault();stop();reject(new Error('Persetujuan dibatalkan'));});
    input.oninput=()=>input.setCustomValidity('');input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submit();}};
    dialog.append(title,note,input,approve,cancel);document.body.append(dialog);dialog.showModal();input.focus();
  });
}
export async function requestFinancialApproval(request:ApprovalRequest){
  if(!navigator.onLine)throw new Error('Tindakan finansial memerlukan persetujuan server saat online.');
  const pin=await ownerPin();
  return (await financeRequest('approve',{...request,pin})).approvalGrant as string;
}
