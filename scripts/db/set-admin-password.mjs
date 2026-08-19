/**
 * Menetapkan password konsol internal.
 *
 *   npm run admin:password -- ops@newhopepos.id
 *   npm run admin:password -- ops@newhopepos.id --role ROLE_SUPERADMIN
 *
 * Password TIDAK diambil dari argumen baris perintah — argumen tersimpan di
 * riwayat shell dan terlihat di `ps` oleh setiap pengguna lain di mesin itu.
 * Skrip ini menanyakannya lewat stdin dengan gema dimatikan.
 *
 * Ini satu-satunya jalan untuk memberi akun internal password. Tidak ada
 * password bawaan, tidak ada jalur bootstrap lewat variabel lingkungan, dan
 * tidak ada seed yang mengisinya — akun yang belum pernah disentuh skrip ini
 * tidak bisa dipakai login sama sekali.
 */

import readline from 'node:readline';
import pg from 'pg';
import { hashPassword } from '../../src/server/adminAuth.ts';

const ROLES = ['ROLE_SUPERADMIN', 'ROLE_INTERNAL_GROWTH', 'ROLE_INTERNAL_SUPPORT'];
const PANJANG_MIN = 12;

function argumen() {
  const argv = process.argv.slice(2);
  const email = argv.find((a) => !a.startsWith('--'));
  const iRole = argv.indexOf('--role');
  return { email, role: iRole >= 0 ? argv[iRole + 1] : null };
}

/** Membaca satu baris tanpa menampilkannya di layar. */
function tanyaRahasia(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          'stdin bukan terminal. Jalankan skrip ini langsung dari terminal — ' +
            'password sengaja tidak bisa dialirkan lewat pipa atau argumen.'
        )
      );
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      // Menimpa gema yang sudah terlanjur tercetak readline.
      if (!['\n', '\r', ''].includes(char.toString('utf8'))) {
        process.stdout.write('\x1b[2K\x1b[200D' + prompt + '*'.repeat(rl.line.length));
      }
    };

    process.stdin.on('data', onData);
    rl.question(prompt, (jawab) => {
      process.stdin.off('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(jawab);
    });
  });
}

async function main() {
  const { email, role } = argumen();

  if (!email) {
    console.error('Pemakaian: npm run admin:password -- <email> [--role ROLE_SUPERADMIN]');
    process.exit(2);
  }
  if (role && !ROLES.includes(role)) {
    console.error(`Role tidak dikenal: ${role}. Pilih salah satu dari ${ROLES.join(', ')}.`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL belum diisi.');
    process.exit(2);
  }

  const password = await tanyaRahasia(`Password baru untuk ${email}: `);
  const ulang = await tanyaRahasia('Ulangi password              : ');

  if (password !== ulang) {
    console.error('\nKedua password tidak sama. Tidak ada yang diubah.');
    process.exit(1);
  }
  if (password.length < PANJANG_MIN) {
    console.error(`\nPassword minimal ${PANJANG_MIN} karakter. Tidak ada yang diubah.`);
    process.exit(1);
  }

  const lokal = /@(127\.0\.0\.1|localhost)/.test(process.env.DATABASE_URL);
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: lokal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const hash = await hashPassword(password);

    // Akun dibuat kalau belum ada, supaya menyiapkan admin pertama tidak
    // menuntut siapa pun menulis INSERT manual ke tabel identitas.
    const { rows } = await client.query(
      `INSERT INTO internal.internal_users (id, email, full_name, role, password_hash, password_set_at)
       VALUES (uuidv7(), $1, $2, $3::internal_role_enum, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (email) DO UPDATE SET
         password_hash      = EXCLUDED.password_hash,
         password_set_at    = CURRENT_TIMESTAMP,
         failed_login_count = 0,
         locked_until       = NULL,
         role               = COALESCE($3::internal_role_enum, internal_users.role),
         is_active          = TRUE
       RETURNING email, role, (xmax = 0) AS baru`,
      [email.toLowerCase().trim(), email.split('@')[0], role || 'ROLE_INTERNAL_SUPPORT', hash]
    );

    const r = rows[0];
    console.log(`\n${r.baru ? 'Akun dibuat' : 'Password diperbarui'}: ${r.email} (${r.role})`);

    if (!process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET.length < 32) {
      console.log(
        '\nPERHATIAN: ADMIN_SESSION_SECRET belum diisi (minimal 32 karakter).\n' +
          'Login akan tetap ditolak sampai variabel itu ada di lingkungan server.\n' +
          'Bangkitkan satu dengan:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`\nGagal: ${err.message}`);
  process.exit(1);
});
