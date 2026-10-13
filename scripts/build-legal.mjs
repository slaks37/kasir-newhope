import {build} from 'esbuild';
import {writeFile,unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {loadEnv} from 'vite';
const file=path.resolve('dist/.legal-content.mjs');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
try{
 await build({entryPoints:['src/config/legalNotices.ts'],bundle:true,platform:'node',format:'esm',outfile:file});
 const {legalNotices,LEGAL_NOTICE_VERSION,SERVICE_OPERATOR_NAME,SERVICE_OPERATOR_ADDRESS,SERVICE_PRIVACY_EMAIL}=await import(pathToFileURL(file).href);
 const env=loadEnv('production',process.cwd(),'VITE_PUBLIC_');
 const email=(env.VITE_PUBLIC_PRIVACY_EMAIL||SERVICE_PRIVACY_EMAIL||'').trim();
 const contact=/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)&&!email.endsWith('.invalid')&&!email.includes('example.')
  ? `<p>Kontak privasi/dukungan: <a href="mailto:${escape(email)}">${escape(email)}</a>. Jangan kirim password, NIK, foto identitas atau data kartu pada pesan awal.</p>`
  : '<p>Kontak privasi publik belum dikonfigurasi. Pemilik akun dapat mengajukan permintaan melalui Pengaturan → Privasi & Permintaan Data setelah <a href="/login">masuk</a>. Kontak untuk pemohon tanpa akun wajib diverifikasi pemilik sebelum rilis.</p>';
 const support={title:'Bantuan & Privasi',sections:[['Permintaan data','Pemilik akun: Pengaturan → Privasi & Permintaan Data. Pilih akses, koreksi, penghapusan, ekspor atau penarikan persetujuan. Permintaan memiliki nomor dan status, memerlukan verifikasi identitas serta tinjauan retensi. Pelanggan dan staf toko: hubungi toko yang mengelola data Anda; toko dapat meneruskan permintaan terverifikasi. Tidak perlu mengirim dokumen identitas pada kontak pertama.'],['Pembayaran dan gangguan','Sertakan nomor invoice atau referensi transaksi yang relevan, tanpa rahasia pembayaran. DOKU langganan terpisah dari pembayaran pelanggan usaha. Penerimaan permintaan tidak menjanjikan refund sebelum review.']]};
 for(const [slug,page] of Object.entries({...legalNotices,support})){
  const sections=page.sections.map(([title,text])=>`<section><h2>${escape(title)}</h2><p>${escape(text)}</p></section>`).join('');
  await writeFile(`dist/${slug}.html`,`<!doctype html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(page.title)}</title><meta name="description" content="${escape(page.title)}: informasi layanan, pemrosesan dan permintaan data."><link rel="canonical" href="https://kasir.newhope.space/${slug}"><style>body{margin:0;color:#17212f;background:#fafaf7;font:16px/1.7 system-ui,sans-serif}main{max-width:820px;margin:auto;padding:28px 20px}nav{display:flex;flex-wrap:wrap;gap:18px}a{color:#753800}h1{font-size:2rem;line-height:1.25}h2{font-size:1.25rem;margin:28px 0 8px}p{margin:8px 0}.version{color:#515a65}</style></head><body><main><nav><a href="/">New Hope POS</a><a href="/privacy">Privasi</a><a href="/terms">Syarat</a><a href="/support">Bantuan</a><a href="/login">Masuk</a></nav><h1>${escape(page.title)}</h1><p class="version">Versi ${escape(LEGAL_NOTICE_VERSION)} · Bahan review pemilik dan penasihat hukum</p>${sections}${contact}<footer><p>New Hope POS · Pengelola: ${escape(SERVICE_OPERATOR_NAME)} · Alamat yang disampaikan pemilik: ${escape(SERVICE_OPERATOR_ADDRESS)}. Bentuk/status badan usaha, kelengkapan alamat dan persetujuan hukum wajib diverifikasi.</p></footer></main></body></html>`);
 }
 console.log('Built privacy, terms and support as standalone HTML; no account data or client scripts.');
}finally{await unlink(file).catch(()=>{});}
