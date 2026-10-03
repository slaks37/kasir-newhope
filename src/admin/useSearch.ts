import {useEffect,useState} from 'react';
/** Avoid a remote request on each keystroke, without caching customer data. */
export function useSearch(value:string) {
  const [settled,setSettled]=useState(value);
  useEffect(()=>{const timer=setTimeout(()=>setSettled(value),300);return()=>clearTimeout(timer);},[value]);
  return settled;
}
