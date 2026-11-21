import { readFile } from "node:fs/promises";
import {
  contractOutputsMatch,
  projectJavaScriptOutput,
  runWasm
} from "../server/intelligence/wasm/engine.js";

const fixturePath = new URL("../contracts/fixtures/intelligence-v1.json", import.meta.url);
const fixtures = JSON.parse(await readFile(fixturePath, "utf8"));
const results = [];
let mismatches = 0;
const iterations = Math.max(1, Number.parseInt(process.env.SHADOW_BENCH_ITERATIONS || "100", 10));
let coldWasmMs = null;

for (const fixture of fixtures) {
  try {
    const jsStarted = performance.now();
    const javascript = projectJavaScriptOutput(fixture.input);
    const javascriptMs = performance.now() - jsStarted;
    const wasmStarted = performance.now();
    const wasm = await runWasm(fixture.input);
    const wasmMs = performance.now() - wasmStarted;
    if (coldWasmMs === null) coldWasmMs = wasmMs;
    const matched = contractOutputsMatch(javascript, wasm);
    if (!matched) mismatches += 1;
    results.push({
      name: fixture.name,
      matched,
      javascriptMs: Number(javascriptMs.toFixed(3)),
      wasmFirstObservedMs: Number(wasmMs.toFixed(3))
    });
  } catch (error) {
    mismatches += 1;
    results.push({
      name: fixture.name,
      matched: false,
      error: error?.message || String(error)
    });
  }
}

const memoryBefore = process.memoryUsage();
const javascriptWarmMs = [];
const wasmWarmMs = [];
let candidateCalls = 0;
for (const fixture of fixtures) {
  candidateCalls += fixture.input.candidates.length * iterations;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let started = performance.now();
    projectJavaScriptOutput(fixture.input);
    javascriptWarmMs.push(performance.now() - started);
    started = performance.now();
    await runWasm(fixture.input);
    wasmWarmMs.push(performance.now() - started);
  }
}
const memoryAfter = process.memoryUsage();

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const javascriptWarmTotalMs = javascriptWarmMs.reduce((total, value) => total + value, 0);
const wasmWarmTotalMs = wasmWarmMs.reduce((total, value) => total + value, 0);
const medianWasmMs = median(wasmWarmMs);

console.log(JSON.stringify({
  contractVersion: "seasonfetch.intelligence.v1",
  mode: "wasm-fixture-parity",
  javascriptAuthoritative: true,
  wasmAdapter: "server/intelligence/wasm/engine.js",
  fixtureCount: fixtures.length,
  mismatches,
  performance: {
    iterationsPerFixture: iterations,
    coldWasmFirstCallMs: coldWasmMs === null ? null : Number(coldWasmMs.toFixed(3)),
    estimatedInitializationOverheadMs: coldWasmMs === null ? null : Number(Math.max(0, coldWasmMs - medianWasmMs).toFixed(3)),
    warmMedianMs: {
      javascript: Number(median(javascriptWarmMs).toFixed(3)),
      wasmAdapter: Number(medianWasmMs.toFixed(3))
    },
    candidateThroughputPerSecond: {
      javascript: Number((candidateCalls / (javascriptWarmTotalMs / 1000)).toFixed(1)),
      wasmAdapter: Number((candidateCalls / (wasmWarmTotalMs / 1000)).toFixed(1))
    },
    memoryBytes: {
      heapUsedDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
      rssDelta: memoryAfter.rss - memoryBefore.rss
    }
  },
  results
}, null, 2));

if (mismatches > 0) process.exitCode = 1;
