import { useEffect, useState } from 'react';
import { subscribeNotices, type Notice } from '../../lib/ui/notify';

const STYLE: Record<Notice['tone'], string> = {
  info: 'border-slate-300 bg-white text-slate-900',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-rose-300 bg-rose-50 text-rose-900',
};

/** Toast stack for notify(). Errors persist until closed; others fade after 6 s. */
export function Notifier() {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => subscribeNotices(notice => {
    setNotices(previous => [...previous.slice(-4), notice]);
    if (notice.tone !== 'error') setTimeout(() => setNotices(previous => previous.filter(n => n.id !== notice.id)), 6000);
  }), []);
  const close = (id: number) => setNotices(previous => previous.filter(n => n.id !== id));
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(92vw,380px)] flex-col gap-2">
      {notices.map(notice => (
        <div key={notice.id} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3 text-sm font-medium shadow-lg ${STYLE[notice.tone]}`}>
          <p className="flex-1 whitespace-pre-line">{notice.message}</p>
          <button type="button" onClick={() => close(notice.id)} aria-label="Tutup notifikasi" className="rounded px-1 font-bold opacity-70 hover:opacity-100">×</button>
        </div>
      ))}
    </div>
  );
}
