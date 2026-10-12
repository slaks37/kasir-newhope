import {build} from 'esbuild';
import {readFile, writeFile, unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {loadEnv} from 'vite';

// Render the same component used by the client. No duplicated marketing copy,
// session credentials or tenant data are present in this build-time render.
const renderer = path.resolve('dist/.landing-renderer.mjs');
try {
  await build({
    stdin: {contents: `import React from 'react';
      import {renderToString} from 'react-dom/server';
      import {HomePage} from './src/components/home/HomePage';
      export const html = renderToString(React.createElement(HomePage, {isStandaloneLanding: true}));`,
      resolveDir: process.cwd(), loader: 'tsx'},
    bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: renderer,
    loader: {'.css': 'empty'}, jsx: 'automatic',
    define: {'import.meta.env': JSON.stringify(loadEnv('production', process.cwd(), 'VITE_'))},
  });
  const {html} = await import(pathToFileURL(renderer).href);
  let page = await readFile('dist/landing.html', 'utf8');
  const styles = [...page.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)];
  for (const [tag] of styles) {
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (!href?.startsWith('/assets/')) throw new Error('Unexpected landing stylesheet');
    const css = await readFile(path.join('dist', href.slice(1)), 'utf8');
    page = page.replace(tag, `<style>${css.replaceAll('</style', '<\\/style')}</style>`);
  }
  page = page.replace('<div id="root"></div>', `<div id="root">${html}</div>`);
  if (!page.includes('<h1')) throw new Error('Landing content was not prerendered');
  // Vercel's static directory index takes priority over a root rewrite.
  // Publish marketing as the actual index and preserve the cashier separately.
  const appShell = await readFile('dist/index.html', 'utf8');
  if (!appShell.includes('<div id="root"></div>')) throw new Error('Run vite build before prerendering; cashier shell must be preserved');
  await writeFile('dist/app.html', appShell);
  await writeFile('dist/landing.html', page);
  await writeFile('dist/index.html', page);
  console.log(`Prerendered public landing: ${Buffer.byteLength(page)} bytes; CSS inline, no auth bootstrap.`);
} finally {
  await unlink(renderer).catch(() => {});
}
