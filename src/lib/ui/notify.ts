/**
 * Non-blocking notifications. Replaces window.alert(), which freezes the whole
 * tab until dismissed (and blocks every timer, sync and print in that tab).
 *
 * Errors stay on screen until the user closes them; other tones fade out.
 * If no <Notifier/> is mounted (e.g. very early boot), it falls back to
 * window.alert so a message is never silently lost.
 */
export type NotifyTone = 'info' | 'success' | 'warning' | 'error';
export interface Notice { id: number; message: string; tone: NotifyTone }

const EVENT = 'nh:notify';
let mounted = 0;
let nextId = 1;

const ERROR = /\b(gagal|ditolak|tidak dapat|tidak bisa|belum disimpan|error|terblokir|bermasalah|failed|denied)\b/i;
const WARNING = /\b(mohon|harap|wajib|kurang|belum|pastikan|izinkan|terkunci|tidak boleh|minimal|maksimal)\b/i;

/** Infer a tone from the message when the caller does not state one. */
export function inferTone(message: string): NotifyTone {
  if (ERROR.test(message)) return 'error';
  if (WARNING.test(message)) return 'warning';
  if (/\b(berhasil|tersimpan|sukses|selesai|disalin|terkirim)\b/i.test(message)) return 'success';
  return 'info';
}

export function notify(message: unknown, tone?: NotifyTone): void {
  const text = String(message ?? '');
  if (typeof window === 'undefined') return;
  if (!mounted) { window.alert(text); return; }
  window.dispatchEvent(new CustomEvent<Notice>(EVENT, { detail: { id: nextId++, message: text, tone: tone ?? inferTone(text) } }));
}

/** Used by <Notifier/> only. Returns an unsubscribe function. */
export function subscribeNotices(listener: (notice: Notice) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<Notice>).detail);
  mounted++;
  window.addEventListener(EVENT, handler);
  return () => { mounted--; window.removeEventListener(EVENT, handler); };
}
