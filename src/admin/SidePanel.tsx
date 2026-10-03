import {useEffect,useId,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

/** One contextual drawer; keep the selected table row visible behind it. */
export default function SidePanel({title,onClose,busy=false,children}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode}) {
  const id=useId(),panel=useRef<HTMLDivElement>(null),latest=useRef({onClose,busy});
  latest.current={onClose,busy};
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
    const background=document.getElementById('root'),wasInert=background?.inert;
    document.body.style.overflow='hidden';panel.current?.focus();
    if(background)background.inert=true;
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'&&!latest.current.busy){e.preventDefault();latest.current.onClose();}
      if(e.key!=='Tab')return;
      const targets=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')||[]).filter(el=>el.getClientRects().length>0);
      const first=targets[0],last=targets[targets.length-1];
      if(!first){e.preventDefault();panel.current?.focus();}
      else if(e.shiftKey&&(document.activeElement===first||!panel.current?.contains(document.activeElement)||document.activeElement===panel.current)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!panel.current?.contains(document.activeElement)||document.activeElement===panel.current)){e.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;if(background)background.inert=wasInert||false;if(previous?.isConnected)previous.focus();};
  },[]);
  return createPortal(<div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id} className="w-full max-w-xl h-full bg-white shadow-2xl flex flex-col text-slate-800 outline-none">
      <header className="border-b border-slate-200 p-5 flex items-center justify-between gap-4"><h2 id={id} className="text-xl font-bold">{title}</h2><button type="button" aria-label="Tutup panel" disabled={busy} onClick={onClose} className="border rounded-lg px-3 py-2 disabled:opacity-50">✕</button></header>
      <div className="overflow-y-auto p-5 space-y-4 flex-1">{children}</div>
    </div>
  </div>,document.body);
}
