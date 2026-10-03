/** EAN-13 checksum for an internal POS code, not a registered GS1 identity. */
export function ean13(body:string){
  if(!/^\d{12}$/.test(body))throw Error('EAN_BODY_MUST_BE_12_DIGITS');
  const sum=[...body].reduce((sum,digit,index)=>sum+Number(digit)*(index%2?3:1),0);
  return body+String((10-sum%10)%10);
}
export function newInternalBarcode(){
  const random=crypto.getRandomValues(new Uint8Array(9));
  return ean13('200'+[...random].map(value=>value%10).join(''));
}
