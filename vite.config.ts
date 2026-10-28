import {offlinePublicKey} from './src/lib/auth/offlineIdentity';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {defineConfig,loadEnv, type Plugin} from 'vite';
import {serviceWorkerSource} from './src/pwa/serviceWorker';

/**
 * Emits /sw.js with the cashier app's assets (everything reachable from the
 * `main` entry, including lazy routes and their CSS). Admin-only chunks are
 * never precached on merchant devices.
 */
function cashierServiceWorker(): Plugin {
  return {
    name: 'newhope-cashier-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item): item is Extract<typeof item, {type: 'chunk'}> => item.type === 'chunk');
      const entry = chunks.find(chunk => chunk.isEntry && chunk.name === 'main');
      if (!entry) return;
      const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
      const files = new Set<string>();
      const visit = (fileName: string) => {
        if (files.has(fileName)) return;
        const chunk = byFile.get(fileName);
        if (!chunk) return;
        files.add(fileName);
        for (const css of (chunk as {viteMetadata?: {importedCss?: Set<string>}}).viteMetadata?.importedCss ?? []) files.add(css);
        [...chunk.imports, ...chunk.dynamicImports].forEach(visit);
      };
      visit(entry.fileName);
      const assets = [...files].sort().map(file => '/' + file);
      const buildId = createHash('sha256').update(assets.join('\n') + serviceWorkerSource('', assets)).digest('hex').slice(0, 12);
      this.emitFile({type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(buildId, assets)});
    },
  };
}

const projectDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({mode}) => {
 const env={...loadEnv(mode,projectDir,'VITE_'),...process.env};
 if(env.VITE_NEWHOPE_OFFLINE_PUBLIC_KEY)offlinePublicKey(env.VITE_NEWHOPE_OFFLINE_PUBLIC_KEY);
  return {
    plugins: [react(), tailwindcss(), cashierServiceWorker()],
    resolve: {
      alias: [...(env.VITE_AUTH_PROVIDER==='neon'?[{find:/^(?:\.{1,2}\/)+(?:(?:lib\/)?supabase|legacyNativeAuth)$/,replacement:path.resolve(projectDir,'src/lib/auth/legacyDisabled.ts')}]:[]),{find:'@',replacement:projectDir}],
    },
    build: {
      manifest:true,
      rollupOptions: {
        // Dua entry terpisah, sengaja. Konsol internal tidak boleh ikut
        // ter-bundle ke aplikasi kasir: kode yang tidak pernah terkirim ke
        // browser merchant adalah kode yang tidak bisa dibaca merchant.
        input: {
          main: path.resolve(projectDir, 'index.html'),
          landing: path.resolve(projectDir, 'landing.html'),
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
