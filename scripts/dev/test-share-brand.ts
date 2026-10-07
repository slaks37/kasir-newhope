import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const asset = '/new-hope-logo-mark.png';
assert.match(html, /property="og:image" content="https:\/\/kasir\.newhope\.space\/new-hope-logo-mark\.png"/);
assert.match(html, /name="twitter:image" content="https:\/\/kasir\.newhope\.space\/new-hope-logo-mark\.png"/);
assert.ok(!html.includes('Shopping%20Bags') && !html.includes('Animated-Fluent-Emojis'));
assert.match(html, /rel="apple-touch-icon"\s+href="\/new-hope-logo-mark\.png"/);
assert.match(html, /rel="icon"[^>]+href="\/new-hope-logo-mark\.png"/);
const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
assert.ok(manifest.icons.some((icon: { src: string; type: string }) => icon.src === asset && icon.type === 'image/png'));
const png = fs.readFileSync('public' + asset);
assert.equal(png.subarray(1, 4).toString(), 'PNG');
assert.equal(png.readUInt32BE(16), 1024);
assert.equal(png.readUInt32BE(20), 1024);
console.log('PASS: static share metadata, favicon, Apple icon and installed-app icon use the New Hope logo');
