import {Capacitor} from '@capacitor/core';
import {isNative} from './platform';
export function deviceCapabilities(){return {camera:isNative()?Capacitor.isPluginAvailable('Camera'):!!globalThis.navigator?.mediaDevices,keyboardBarcode:true,nativeBarcode:false,bluetoothPrinter:false,printing:!isNative(),fileShare:isNative()?Capacitor.isPluginAvailable('Share'):!!globalThis.navigator?.share,notifications:false};}
export async function captureProductPhoto():Promise<Blob>{
 if(!isNative())throw Error('Gunakan pemilih berkas atau kamera browser.');
 const {Camera,CameraResultType,CameraSource}=await import('@capacitor/camera');
 const photo=await Camera.getPhoto({resultType:CameraResultType.Uri,source:CameraSource.Prompt,quality:85,width:1600,saveToGallery:false});
 if(!photo.webPath)throw Error('PHOTO_UNAVAILABLE');return (await fetch(photo.webPath)).blob();
}
export async function exportFile(name:string,blob:Blob){
 if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(name))throw Error('INVALID_EXPORT_NAME');
 if(!isNative()){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);return;}
 const [{Filesystem,Directory},{Share}]=await Promise.all([import('@capacitor/filesystem'),import('@capacitor/share')]);
 const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
 const path='exports/'+crypto.randomUUID()+'-'+name;
 const result=await Filesystem.writeFile({path,data,directory:Directory.Cache,recursive:true});
 try{await Share.share({files:[result.uri],title:name});}finally{await Filesystem.deleteFile({path,directory:Directory.Cache});}
}
export function printReceipt(){if(isNative())throw Error('Printer native belum didukung; gunakan ekspor berkas atau printer browser.');window.print();}
