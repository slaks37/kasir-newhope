// Dev-only harness, excluded from Vite production inputs. Never real merchant data.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {IntelligencePanel} from '../../src/components/ai/IntelligencePanel';
import {fixture} from './brainFixture';
import '../../src/index.css';
function Preview() {
  const [free,setFree]=useState(false);
  const s=free?{...fixture,settings:{...fixture.settings,subscription:{status:'FREE' as const,planId:'plan-free-lifetime',currentPeriodEnd:'2099-01-01'}}}:fixture;
  return <main className="mx-auto max-w-6xl space-y-4 bg-slate-50 p-4">
    <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">QA ONLY · data sintetis, tidak tersambung ke database atau DeepSeek.</p>
    <label><input type="checkbox" checked={free} onChange={e=>setFree(e.target.checked)}/> Simulasi Free — panel harus tersembunyi</label>
    <IntelligencePanel key={String(free)} snapshot={s as typeof fixture}/>
  </main>;
}
const root=createRoot(document.getElementById('root')!);
root.render(<Preview/>);
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
