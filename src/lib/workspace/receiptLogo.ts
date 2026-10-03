const key=(owner:string,businessId:string)=>`newhope_receipt_logo_v1_${owner}_${businessId}`;
const raster=(value:unknown)=>value===null||typeof value==='string'&&value.length<=200000&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
/** Only a successful authenticated logo read writes this cache. No global or
 * other-sector logo fallback; this asset is never authorization or a ledger. */
export function saveReceiptLogo(owner:string,businessId:string,logoUrl:unknown){
  if(!raster(logoUrl))throw Error('INVALID_RECEIPT_LOGO');
  localStorage.setItem(key(owner,businessId),JSON.stringify({owner,businessId,logoUrl}));
}
export function readReceiptLogo(owner:string,businessId:string):string|undefined{
  try{
    const row=JSON.parse(localStorage.getItem(key(owner,businessId))||'null');
    return row?.owner===owner&&row.businessId===businessId&&raster(row.logoUrl)?row.logoUrl||undefined:undefined;
  }catch{return undefined;}
}
