import React,{useMemo} from 'react';
import {usePOS} from '../../context/POSContext';
import {useIntelligenceSnapshot} from './useIntelligenceSnapshot';
import {recentBasketOffers,nextBestOffers} from '../../lib/assistant/businessBrain';
import {isFreePlan} from '../../config/freePlanPolicy';
import {formatRupiah} from '../../utils/formatters';
export function UpsellSuggestions(){
  const snapshot=useIntelligenceSnapshot();const {cart,products,addToCart,settings}=usePOS();
  const enabled=!isFreePlan(settings.subscription);
  const brain=useMemo(()=>enabled?{offers:recentBasketOffers(snapshot)}:null,[snapshot,enabled]);
  const offers=brain?nextBestOffers(brain,cart,products).filter(o=>{const p=products.find(p=>p.id===o.bId);return p&&!p.variants?.length&&!p.modifierGroups?.some(g=>g.required);}):[];
  if(!offers.length)return null;
  return <aside aria-label="Saran tambahan keranjang" className="mx-3 my-2 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-900">Sering dibeli bersama · data perangkat</p>{offers.map(o=>{const p=products.find(p=>p.id===o.bId)!;return <div key={o.bId} className="mt-2 flex items-center justify-between gap-2"><p className="text-xs text-slate-700">{o.bName} · {formatRupiah(p.price)}<br/><span className="text-slate-500">{Math.round(o.confidence*100)}% keranjang {o.aName} · {o.count} contoh</span></p><button type="button" className="shrink-0 rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-bold text-amber-900" onClick={()=>addToCart(p)}>+ Tambahkan</button></div>;})}</aside>;
}
