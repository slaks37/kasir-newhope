/**
 * E2E untuk JALUR KASIR — satu-satunya jalur yang kalau rusak, merchant tidak
 * bisa berjualan sama sekali.
 *
 * Seluruh uji lain di repositori ini memeriksa satu lapisan: byte ESC/POS,
 * kueri SQL, aturan otorisasi. Tidak satu pun membuktikan bahwa seorang kasir
 * bisa membuka shift, menjual sesuatu, menerima uang, dan menutup shift. Itu
 * yang diuji di sini, lewat peramban sungguhan pada aplikasi yang sudah
 * di-build.
 *
 * Memakai build produksi (`vite preview`), bukan dev server: yang perlu
 * dibuktikan adalah aplikasi yang akan dipakai merchant, termasuk pemecahan
 * bundel dan lazy-loading yang hanya terjadi setelah build.
 */
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/*
 * Peramban yang dipakai.
 *
 * Di lingkungan pengembangan ini Chromium sudah terpasang dengan nomor build
 * yang TIDAK cocok dengan yang dituntut Playwright, jadi ia ditunjuk langsung.
 * Di CI peramban dipasang oleh `playwright install`, dan jalur tetap itu tidak
 * ada — karena itu keberadaannya DIPERIKSA, bukan diasumsikan. Konfigurasi
 * yang menunjuk berkas yang tidak ada akan gagal dengan pesan "Executable
 * doesn't exist", yang tidak memberi tahu siapa pun apa yang harus dilakukan.
 */
const CHROMIUM_LOKAL =
  process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pakaiChromiumLokal = !!CHROMIUM_LOKAL && existsSync(CHROMIUM_LOKAL);

export default defineConfig({
  testDir: './e2e',
  // Berurutan, satu pekerja. Uji ini memakai localStorage bersama sebagai
  // sistem pencatatan; dua peramban paralel akan saling menimpa shift.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: pakaiChromiumLokal ? { executablePath: CHROMIUM_LOKAL } : {},
      },
    },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
