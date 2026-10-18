#!/usr/bin/env node
// Draws this demo's pictures, so they are made here and need no licence: desk.png, a home office with a laptop, a router
// and a server, and slow.png and fast.png, a product page still loading and the same page loaded.
// Run `node examples/primitives/image/make-pictures.mjs` from the repository; it needs sharp, a dev dependency.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));

const desk = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3550"/><stop offset="1" stop-color="#1b2133"/></linearGradient>
    <linearGradient id="desk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5a35"/><stop offset="1" stop-color="#5c3a20"/></linearGradient>
    <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4e7cff"/><stop offset="1" stop-color="#7c4dff"/></linearGradient>
    <radialGradient id="lamp" cx="0.5" cy="0" r="0.9"><stop offset="0" stop-color="#ffe7a8" stop-opacity="0.55"/><stop offset="1" stop-color="#ffe7a8" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#wall)"/>
  <rect x="0" y="0" width="1600" height="700" fill="url(#lamp)"/>
  <rect x="120" y="120" width="380" height="260" rx="10" fill="#36456b" stroke="#55648c" stroke-width="10"/>
  <path d="M130 360 L250 230 L330 300 L400 250 L490 360 Z" fill="#4f6b5a"/>
  <circle cx="420" cy="180" r="34" fill="#f6d97a"/>
  <rect x="0" y="690" width="1600" height="60" fill="url(#desk)"/>
  <rect x="60" y="750" width="40" height="250" fill="#4a2f1a"/>
  <rect x="1500" y="750" width="40" height="250" fill="#4a2f1a"/>
  <g transform="translate(560 380)">
    <rect x="0" y="0" width="520" height="320" rx="18" fill="#11151f"/>
    <rect x="18" y="18" width="484" height="270" rx="6" fill="url(#screen)"/>
    <rect x="50" y="60" width="260" height="22" rx="6" fill="#ffffff" opacity="0.85"/>
    <rect x="50" y="100" width="380" height="14" rx="6" fill="#ffffff" opacity="0.5"/>
    <rect x="50" y="128" width="330" height="14" rx="6" fill="#ffffff" opacity="0.5"/>
    <rect x="50" y="190" width="140" height="44" rx="10" fill="#3ddc97"/>
    <path d="M-60 320 L580 320 L620 350 L-100 350 Z" fill="#2a3040"/>
  </g>
  <g transform="translate(1180 560)">
    <rect x="0" y="40" width="240" height="90" rx="16" fill="#e8ebf2"/>
    <rect x="30" y="-60" width="10" height="110" rx="5" fill="#cfd4df"/>
    <rect x="200" y="-60" width="10" height="110" rx="5" fill="#cfd4df"/>
    <circle cx="50" cy="90" r="8" fill="#3ddc97"/><circle cx="80" cy="90" r="8" fill="#3ddc97"/><circle cx="110" cy="90" r="8" fill="#fbbf24"/>
  </g>
  <g transform="translate(1280 120)">
    <rect x="0" y="0" width="200" height="440" rx="14" fill="#151a26" stroke="#2c3550" stroke-width="6"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="20" y="${24 + i * 82}" width="160" height="62" rx="8" fill="#232b3d"/><circle cx="150" cy="${55 + i * 82}" r="7" fill="${i === 2 ? '#ff6b7a' : '#3ddc97'}"/><rect x="36" y="${48 + i * 82}" width="80" height="12" rx="4" fill="#3a4560"/>`).join('')}
  </g>
  <path d="M1300 690 C1250 640 1220 650 1210 660" stroke="#9aa3b8" stroke-width="8" fill="none"/>
  <path d="M1080 680 C1130 640 1160 640 1190 650" stroke="#9aa3b8" stroke-width="8" fill="none"/>
  <g transform="translate(330 560)">
    <rect x="0" y="40" width="110" height="90" rx="10" fill="#e8ebf2"/>
    <path d="M110 60 C150 60 150 110 110 110" stroke="#e8ebf2" stroke-width="14" fill="none"/>
    <path d="M30 20 C20 0 50 -10 40 -30 M70 20 C60 0 90 -10 80 -30" stroke="#cfd4df" stroke-width="6" fill="none" opacity="0.7"/>
  </g>
</svg>`;

/** A product page: with `loaded`, its picture, title, price and button; without, grey blocks and a spinner. */
const page = (loaded) => `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#f4f6fb"/>
  <rect width="960" height="64" fill="#ffffff"/>
  <rect x="32" y="22" width="120" height="20" rx="6" fill="#5b6cff"/>
  <rect x="700" y="24" width="220" height="16" rx="8" fill="#e3e7f0"/>
  ${
    loaded
      ? `<rect x="48" y="104" width="400" height="380" rx="18" fill="#ffd9a8"/><circle cx="248" cy="290" r="110" fill="#ff9f43"/><rect x="500" y="120" width="380" height="34" rx="8" fill="#1b2133"/><rect x="500" y="176" width="300" height="18" rx="6" fill="#9097a8"/><rect x="500" y="206" width="330" height="18" rx="6" fill="#9097a8"/><rect x="500" y="262" width="150" height="40" rx="8" fill="#1b2133"/><rect x="500" y="404" width="240" height="64" rx="14" fill="#3ddc97"/>`
      : `<rect x="48" y="104" width="400" height="380" rx="18" fill="#e3e7f0"/><circle cx="248" cy="294" r="42" fill="none" stroke="#c4cad8" stroke-width="12" stroke-dasharray="180 90"/><rect x="500" y="120" width="380" height="34" rx="8" fill="#e3e7f0"/><rect x="500" y="176" width="300" height="18" rx="6" fill="#e3e7f0"/><rect x="500" y="206" width="330" height="18" rx="6" fill="#e3e7f0"/><rect x="500" y="262" width="150" height="40" rx="8" fill="#e3e7f0"/><rect x="500" y="404" width="240" height="64" rx="14" fill="#e3e7f0"/>`
  }
</svg>`;

const write = (svg, name) =>
  sharp(Buffer.from(svg)).png({ palette: true, compressionLevel: 9 }).toFile(path.join(here, name));
await write(desk, 'desk.png');
await write(page(false), 'slow.png');
await write(page(true), 'fast.png');
console.log('desk.png, slow.png, fast.png');
