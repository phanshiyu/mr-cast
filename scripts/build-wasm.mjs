#!/usr/bin/env node
// Builds the browser player's renderer (engine/wasm) into engine/wasm/pkg, which vite bundles into dist/. Needs
// Rust with the wasm32-unknown-unknown target and wasm-bindgen-cli at the version engine/wasm/Cargo.toml pins:
//
//   rustup target add wasm32-unknown-unknown
//   cargo install wasm-bindgen-cli --version <that version> --locked

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../engine');
const OUT = path.join(ENGINE, 'wasm/pkg');
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: ENGINE });

const pinned = /wasm-bindgen = "=([\d.]+)"/.exec(fs.readFileSync(path.join(ENGINE, 'wasm/Cargo.toml'), 'utf8'))?.[1];
let have = '';
try {
  have = execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).trim().split(' ')[1];
} catch {
  /* reported below */
}
if (have !== pinned) {
  console.error(
    `build-wasm: wasm-bindgen ${pinned} is needed (${have ? `found ${have}` : 'none found'}); run cargo install wasm-bindgen-cli --version ${pinned} --locked`,
  );
  process.exit(1);
}
run('cargo', ['build', '--release', '-p', 'mrc_wasm', '--target', 'wasm32-unknown-unknown']);
fs.rmSync(OUT, { recursive: true, force: true });
run('wasm-bindgen', [
  '--target',
  'web',
  '--out-dir',
  OUT,
  '--out-name',
  'mrc_wasm',
  path.join(ENGINE, 'target/wasm32-unknown-unknown/release/mrc_wasm.wasm'),
]);
console.log(`build-wasm: ${path.relative(process.cwd(), OUT)}`);
