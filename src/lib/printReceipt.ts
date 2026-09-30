let activePrint: Promise<void> | undefined;

/** Print only the receipt, outside fixed/scrolling modal ancestors.
 * Uses the Windows printer driver (including paired Bluetooth printers).
 * Opening the dialog is not confirmation that paper was printed.
 */
export async function printReceiptImages(containerId: string): Promise<void> {
  if (activePrint) return activePrint;
  activePrint = printReceiptDocument(containerId);
  try { await activePrint; } finally { activePrint = undefined; }
}

async function printReceiptDocument(containerId: string): Promise<void> {
  const receipt = document.getElementById(containerId);
  if (!receipt) throw new Error('Nota belum siap. Tutup lalu buka kembali nota.');
  const frame = document.createElement('iframe');
  frame.title = 'Cetak nota';
  frame.setAttribute('aria-hidden', 'true');
  // Do not use display:none: Chromium may render a blank print document.
  Object.assign(frame.style, { position: 'fixed', width: '1px', height: '1px', right: '0', bottom: '0', border: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const printWindow = frame.contentWindow;
  if (!doc || !printWindow) { frame.remove(); throw new Error('Dokumen cetak tidak dapat dibuka.'); }
  const cleanup = () => frame.remove();
  try {
    doc.title = 'Nota New Hope POS';
    const base = doc.createElement('base');
    base.href = document.baseURI;
    doc.head.appendChild(base);
    const styleLoads: Promise<void>[] = [];
    for (const source of document.querySelectorAll('style, link[rel="stylesheet"]')) {
      const copy = source.cloneNode(true) as HTMLElement;
      if (copy.tagName === 'LINK') {
        styleLoads.push(new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('Format nota gagal dimuat. Coba cetak lagi.')), 10000);
          copy.onload = () => { window.clearTimeout(timer); resolve(); };
          copy.onerror = () => { window.clearTimeout(timer); reject(new Error('Format nota gagal dimuat. Coba cetak lagi.')); };
        }));
      }
      doc.head.appendChild(copy);
    }
    const clone = receipt.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, iframe, button').forEach(node => node.remove());
    doc.body.appendChild(clone);
    const narrow = receipt.classList.contains('paper-58mm');
    // Inline !important outranks the app's ID/class-based print selectors.
    for (const [property, value] of Object.entries({
      position: 'static', width: narrow ? '48mm' : '72mm', 'min-width': '0',
      'max-width': narrow ? '48mm' : '72mm', margin: '0', overflow: 'visible',
      'break-inside': 'auto', 'page-break-inside': 'auto',
    })) clone.style.setProperty(property, value, 'important');
    const style = doc.createElement('style');
    style.textContent = `
      @page { size: auto; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; height: auto !important; overflow: visible !important; background: white !important; }
      body * { visibility: visible !important; }
      body > div { position: static !important; width: ${narrow ? '48' : '72'}mm !important; min-width: 0 !important; max-width: ${narrow ? '48' : '72'}mm !important; margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; overflow: visible !important; break-inside: auto !important; page-break-inside: auto !important; }
      img, tr { break-inside: avoid; }
      img { max-width: 100%; }
    `;
    doc.head.appendChild(style);
    await Promise.all(styleLoads);
    await Promise.all(Array.from(doc.images).map(async image => {
      try { await image.decode(); } catch { /* A failed logo does not block the receipt. */ }
    }));
    await doc.fonts.ready;
    // A layout read ensures the cloned receipt has been measured before print.
    clone.getBoundingClientRect();
    printWindow.addEventListener('afterprint', cleanup, { once: true });
    printWindow.focus();
    printWindow.print();
    // Some Chromium versions omit afterprint when the dialog is cancelled.
    window.setTimeout(cleanup, 300000);
  } catch (error) { cleanup(); throw error; }
}
