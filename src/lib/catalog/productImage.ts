// A thumbnail travels with the existing versioned product record, so it is
// durable offline and hydrates on every device. Never enqueue the original 5MB
// file: the shared-state API has a 64k record limit. No new public bucket/RLS.
export const PRODUCT_IMAGE_MAX_CHARS=40000;
export function validateProductImageFile(file:Pick<File,'type'|'size'>){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Gunakan foto JPG, PNG, atau WebP.');
  if(file.size>5*1024*1024)throw Error('Ukuran foto maksimal 5 MB.');
  if(file.size<=0)throw Error('File foto kosong.');
}
export async function productThumbnail(file:File):Promise<string>{
  validateProductImageFile(file);
  const url=URL.createObjectURL(file);
  try{
    const image=new window.Image();image.src=url;await image.decode();
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw Error('Resolusi foto terlalu besar atau tidak valid.');
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    if(!context)throw Error('Foto tidak dapat diproses pada browser ini.');
    for(const edge of [640,480,320,240]){
      const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [.82,.65,.48]){
        const result=canvas.toDataURL('image/jpeg',quality);
        if(result.length<=PRODUCT_IMAGE_MAX_CHARS&&result.startsWith('data:image/jpeg;base64,'))return result;
      }
    }
    throw Error('Foto belum dapat diperkecil. Pilih foto yang lebih sederhana.');
  }catch(error){throw error instanceof Error?error:Error('Foto tidak dapat dibaca.');}
  finally{URL.revokeObjectURL(url);}
}
