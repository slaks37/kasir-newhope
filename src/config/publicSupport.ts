/** Public contact must be deliberately configured, never a demo recipient. */
export function supportWhatsAppUrl(raw: unknown, message: string): string | null {
  const phone = typeof raw === 'string' ? raw.trim().replace(/^\+/, '') : '';
  if (!/^[1-9]\d{7,14}$/.test(phone) || phone === '6281234567890') return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
