import { newDocumentNumber } from '../lib/ids';

// Format Nominal Rupiah (cth: Rp 25.000)
export function formatRupiah(amount: number): string {
  if (isNaN(amount) || amount === null || amount === undefined) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Format Tanggal & Waktu Lokal Indonesia
export function formatDateTime(dateString: string | Date): string {
  const d = typeof dateString === 'string' ? new Date(dateString) : dateString;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

// Format Tanggal Singkat (08 Ags 2026)
export function formatDateOnly(dateString: string | Date): string {
  const d = typeof dateString === 'string' ? new Date(dateString) : dateString;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/**
 * Nomor faktur yang dicetak di struk.
 *
 * Tidak lagi sekuensial. Dua alasan:
 *   1. Dua terminal yang offline sama-sama melihat `orders.length` lokalnya,
 *      jadi keduanya menghasilkan nomor yang sama dan saling menimpa saat sync.
 *   2. `INV-20260811-0004` memberitahu siapa pun yang memegang struk berapa
 *      banyak transaksi toko itu hari itu.
 *
 * `orderCount` dipertahankan agar pemanggil lama tidak perlu diubah, tapi tidak
 * lagi menentukan keunikan.
 */
export function generateInvoiceNumber(_orderCount?: number): string {
  return newDocumentNumber('INV');
}

// Web Audio API Sound Effects (Beep & Success Chime)
export function playPOSSound(type: 'add_item' | 'payment_success' | 'click' | 'delete') {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    if (type === 'add_item' || type === 'click') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(type === 'click' ? 600 : 900, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === 'delete') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === 'payment_success') {
      // Arpeggio chime
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
        gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.3);
      });
    }
  } catch (err) {
    // Audio Context fail silently if user hasn't interacted
  }
}
