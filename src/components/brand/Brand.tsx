export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M8 8h24v27l-4-3-4 3-4-3-4 3-4-3-4 3V8Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M13 21a7 7 0 0 1 14 0H13Z" fill="currentColor" />
      <path d="M12 26h16M20 3v3M7 7l3 3M33 7l-3 3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ admin = false }: { admin?: boolean }) {
  return <span className="nh-brand"><span className="nh-brand-mark"><BrandMark /></span><span><strong>new hope<span className="nh-brand-pos"> POS</span></strong><small>{admin ? 'ADMIN WORKSPACE' : 'RUANG TUMBUH USAHA ANDA'}</small></span></span>;
}
