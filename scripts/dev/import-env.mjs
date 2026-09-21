#!/usr/bin/env node
/**
 * Script untuk mengimpor atau memperbarui variabel di .env dengan mudah.
 *
 * Contoh penggunaan:
 *   node scripts/dev/import-env.mjs AGNES_API_KEY="kunci_anda"
 *   node scripts/dev/import-env.mjs --agnes-key="kunci_anda"
 *   node scripts/dev/import-env.mjs --file=.env.production
 *   node scripts/dev/import-env.mjs   (interaktif: akan meminta input API key)
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline';

const ROOT = process.cwd();
const ENV_PATH = resolve(ROOT, '.env');
const EXAMPLE_PATH = resolve(ROOT, '.env.example');

// Pastikan file .env ada
if (!existsSync(ENV_PATH)) {
  if (existsSync(EXAMPLE_PATH)) {
    copyFileSync(EXAMPLE_PATH, ENV_PATH);
    console.log('[import-env] .env dibuat dari .env.example');
  } else {
    writeFileSync(ENV_PATH, '', 'utf8');
    console.log('[import-env] .env baru dibuat');
  }
}

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Penggunaan:
  node scripts/dev/import-env.mjs <KUNCI_API>
  node scripts/dev/import-env.mjs AGNES_API_KEY="kunci_anda"
  node scripts/dev/import-env.mjs --agnes-key="kunci_anda"
  node scripts/dev/import-env.mjs --file=path/to/.env.custom
  npm run env:set AGNES_API_KEY="kunci_anda"
  npm run env:import (interaktif)
`);
    process.exit(0);
  }

  const updates = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--agnes-key=')) {
      updates.AGNES_API_KEY = arg.slice('--agnes-key='.length).trim();
    } else if (arg === '--agnes-key' && args[i + 1]) {
      updates.AGNES_API_KEY = args[++i].trim();
    } else if (arg.startsWith('--file=')) {
      const filePath = resolve(ROOT, arg.slice('--file='.length).trim());
      if (existsSync(filePath)) {
        const fileContent = readFileSync(filePath, 'utf8');
        Object.assign(updates, parseEnvString(fileContent));
      } else {
        console.error(`[import-env] File tidak ditemukan: ${filePath}`);
      }
    } else if (arg.includes('=')) {
      const idx = arg.indexOf('=');
      const key = arg.slice(0, idx).trim();
      const val = arg.slice(idx + 1).trim();
      if (key) updates[key] = val;
    } else if (arg && !arg.startsWith('-') && !updates.AGNES_API_KEY) {
      // Jika argumen tunggal tanpa tanda sama dengan, asumsikan sebagai AGNES_API_KEY
      updates.AGNES_API_KEY = arg.trim();
    }
  }
  return updates;
}

function parseEnvString(str) {
  const result = {};
  const lines = str.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

function maskSecret(val) {
  if (!val) return '(kosong)';
  if (val.length <= 8) return '***';
  return `${val.slice(0, 4)}...${val.slice(-4)}`;
}

function applyUpdates(envContent, updates) {
  let content = envContent;
  for (const [key, value] of Object.entries(updates)) {
    const cleanVal = value.replace(/^["']|["']$/g, '');
    const quoted = `"${cleanVal}"`;
    const regex = new RegExp(`^(\\s*${key}\\s*=).*$`, 'm');

    if (regex.test(content)) {
      content = content.replace(regex, `$1${quoted}`);
    } else {
      content += `\n${key}=${quoted}\n`;
    }
    console.log(`[import-env] ✓ Set ${key} = ${maskSecret(cleanVal)}`);
  }
  return content;
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let updates = parseArgs(args);

  if (Object.keys(updates).length === 0) {
    console.log('=== Import / Konfigurasi Environment Variable ===');
    console.log('Masukkan nilai untuk variabel di bawah (tekan Enter untuk melewati):');
    const agnesKey = await prompt('AGNES_API_KEY: ');
    if (agnesKey) updates.AGNES_API_KEY = agnesKey;

    const agnesBase = await prompt('AGNES_BASE_URL (default: https://apihub.agnes-ai.com/v1): ');
    if (agnesBase) updates.AGNES_BASE_URL = agnesBase;

    const agnesModel = await prompt('AGNES_MODEL (default: agnes-latest): ');
    if (agnesModel) updates.AGNES_MODEL = agnesModel;
  }

  if (Object.keys(updates).length === 0) {
    console.log('[import-env] Tidak ada variabel yang diubah.');
    return;
  }

  const currentContent = readFileSync(ENV_PATH, 'utf8');
  const newContent = applyUpdates(currentContent, updates);
  writeFileSync(ENV_PATH, newContent, 'utf8');
  console.log(`[import-env] Berhasil memperbarui ${ENV_PATH}`);
}

main().catch((err) => {
  console.error('[import-env] Error:', err);
  process.exit(1);
});
