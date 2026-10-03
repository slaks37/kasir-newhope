import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const projectDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': projectDir,
      },
    },
    build: {
      manifest:true,
      rollupOptions: {
        // Dua entry terpisah, sengaja. Konsol internal tidak boleh ikut
        // ter-bundle ke aplikasi kasir: kode yang tidak pernah terkirim ke
        // browser merchant adalah kode yang tidak bisa dibaca merchant.
        input: {
          main: path.resolve(projectDir, 'index.html'),
          admin: path.resolve(projectDir, 'admin.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': {
          target: process.env.VITE_API_URL || 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
