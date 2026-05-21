#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const sharp     = require('sharp');
const { default: pngToIco } = require('png-to-ico');

const ROOT   = path.resolve(__dirname, '..');
const SRC    = path.join(ROOT, 'icon-1024.png');
const SIZES  = [16, 32, 48, 64, 128, 256];
const ASSETS = path.join(ROOT, 'assets');
const BUILD  = path.join(ROOT, 'build');

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[generate-icons] Source not found: ${SRC}`);
    process.exit(1);
  }

  fs.mkdirSync(ASSETS, { recursive: true });
  fs.mkdirSync(BUILD,  { recursive: true });

  // Resize source PNG to each required size, keeping PNG buffers for ICO embedding
  console.log('[generate-icons] Resizing to sizes:', SIZES.join(', '));
  const pngBuffers = await Promise.all(
    SIZES.map((s) => sharp(SRC).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
  );

  // Build multi-resolution ICO
  const icoBuffer = await pngToIco(pngBuffers);

  const assetsIco = path.join(ASSETS, 'icon.ico');
  const buildIco  = path.join(BUILD,  'icon.ico');
  fs.writeFileSync(assetsIco, icoBuffer);
  fs.writeFileSync(buildIco,  icoBuffer);
  console.log(`[generate-icons] Written: ${assetsIco} (${(icoBuffer.length / 1024).toFixed(1)} KB)`);
  console.log(`[generate-icons] Written: ${buildIco}`);

  // Copy source PNG as build/icon.png (top-level electron-builder fallback)
  fs.copyFileSync(SRC, path.join(BUILD, 'icon.png'));
  console.log(`[generate-icons] Copied:  ${path.join(BUILD, 'icon.png')}`);
}

main().catch((err) => { console.error('[generate-icons] Failed:', err.message); process.exit(1); });
