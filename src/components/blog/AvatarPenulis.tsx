import React from 'react';
import type { BlogAuthor } from '../../types/blog';

/**
 * Avatar penulis artikel.
 *
 * ADA KARENA `avatar` MENJADI OPSIONAL. Sebelumnya kolom itu wajib dan diisi
 * foto wajah orang asli dari bank foto stok untuk penulis yang tidak pernah
 * ada — foto seseorang yang tidak menulis apa pun, ditampilkan sebagai
 * penulisnya. Fotonya dibuang bersama namanya.
 *
 * Tanpa berkas ini, `<img src={undefined}>` akan merender ikon gambar rusak di
 * setiap kartu artikel: memindahkan masalahnya dari "menyesatkan" ke
 * "kelihatan rusak", bukan menyelesaikannya. Inisial nama jauh lebih tenang,
 * dan tidak mengaku-ngaku siapa pun.
 */
export const AvatarPenulis: React.FC<{ penulis: BlogAuthor; className?: string }> = ({
  penulis,
  className = '',
}) => {
  if (penulis.avatar) {
    return (
      <img
        src={penulis.avatar}
        alt={penulis.name}
        className={`rounded-full object-cover ${className}`}
      />
    );
  }

  const inisial = penulis.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((k) => k[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div
      aria-hidden="true"
      className={`rounded-full bg-slate-800 text-amber-400 font-black flex items-center justify-center shrink-0 ${className}`}
    >
      {inisial || '?'}
    </div>
  );
};
