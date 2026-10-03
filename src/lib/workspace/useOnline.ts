import {useEffect,useState} from 'react';
export function useOnline(){
  const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine);
  useEffect(()=>{const change=()=>setOnline(navigator.onLine);window.addEventListener('online',change);window.addEventListener('offline',change);
    return()=>{window.removeEventListener('online',change);window.removeEventListener('offline',change);};},[]);
  return online;
}
