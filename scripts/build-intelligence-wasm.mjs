#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = path.join(root, "seasonfetch-engine", "Cargo.toml");
const wasm = path.join(root, "seasonfetch-engine", "target", "wasm32-unknown-unknown", "release", "seasonfetch_engine.wasm");
const outDir = path.join(root, "server", "intelligence", "wasm", "pkg");
const expectedBindgen = "wasm-bindgen 0.2.130";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run("cargo", ["build", "--locked", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", manifest]);
const bindgen = spawnSync("wasm-bindgen", ["--version"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
if (bindgen.error || bindgen.status !== 0 || bindgen.stdout.trim() !== expectedBindgen) {
  console.error(`Expected ${expectedBindgen}. Install it with: cargo install wasm-bindgen-cli --version 0.2.130 --locked`);
  process.exit(1);
}
run("wasm-bindgen", ["--target", "web", "--out-dir", outDir, "--out-name", "seasonfetch_engine", wasm]);
console.log(`Generated Node ESM glue and WASM in ${path.relative(root, outDir)}`);
