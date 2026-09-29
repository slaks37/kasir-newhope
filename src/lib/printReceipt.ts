/** Wait for receipt images before opening the browser print dialog. */
export async function printReceiptImages(containerId: string): Promise<void> {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>(`#${containerId} img`));
  await Promise.all(images.map(async image => {
    if (image.complete) return;
    try { await image.decode(); } catch { /* A failed logo must not block printing. */ }
  }));
  window.print();
}
