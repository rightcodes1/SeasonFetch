import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { processReleases } from "../../intelligence/pipeline.js";
import { processTorrentioResults } from "../../intelligence/providers/torrentioAdapter.js";
import {
  buildEngineInput,
  contractOutputsMatch,
  projectJavaScriptOutput,
  runWasm
} from "../../intelligence/wasm/engine.js";

const fixtureUrl = new URL("../../../contracts/fixtures/intelligence-v1.json", import.meta.url);
const profiles = ["best-overall", "smallest-acceptable", "highest-quality", "most-reliable"];
const streams = [
  {
    title: "[GroupA] Example S01E01 2160p WEB-DL HEVC 2 GB 👤 50 English Dub",
    infoHash: "a".repeat(40),
    fileIdx: 0
  },
  {
    title: "[GroupB] Example S01E01 1080p WEB-DL AVC 700 MB 👤 500 English Dub",
    infoHash: "b".repeat(40),
    fileIdx: 0
  },
  {
    title: "[GroupC] Example S01E01 720p WEB-DL 350 MB 👤 10",
    infoHash: "c".repeat(40),
    fileIdx: 0
  }
];

function withMode(mode, fn) {
  const previous = process.env.SEASONFETCH_INTELLIGENCE_MODE;
  process.env.SEASONFETCH_INTELLIGENCE_MODE = mode;
  return Promise.resolve().then(fn).finally(() => {
    if (previous === undefined) delete process.env.SEASONFETCH_INTELLIGENCE_MODE;
    else process.env.SEASONFETCH_INTELLIGENCE_MODE = previous;
  });
}

test("WASM initializes and exactly matches JavaScript across contract fixtures", async () => {
  const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8"));
  assert.ok(fixtures.length >= 3, "expected the contract fixture set to cover core behavior");

  for (const fixture of fixtures) {
    const wasm = await runWasm(fixture.input);
    const javascript = projectJavaScriptOutput(fixture.input);
    assert.equal(contractOutputsMatch(javascript, wasm), true, fixture.name);
  }
});

test("WASM rejects duplicate candidate identities rather than returning ambiguous mappings", async () => {
  const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const invalid = structuredClone(fixtures[0].input);
  invalid.candidates[1].id = invalid.candidates[0].id;
  await assert.rejects(runWasm(invalid));
});

test("WASM adapter normalizes request and file-index values to the contract uint32 bounds", () => {
  const input = buildEngineInput([{
    candidateId: "candidate-large-index",
    title: "Example",
    infoHash: "e".repeat(40),
    fileIdx: 0x1_0000_0000
  }], {
    season: 0x1_0000_0000,
    episode: 0x1_0000_0000
  });
  assert.equal(input.request.season, null);
  assert.equal(input.request.episode, null);
  assert.equal(input.candidates[0].fileIdx, null);
});

test("WASM adapter maps ranked records to the selected profile without mixing profile scores", async () => {
  await withMode("wasm", async () => {
    for (const profile of profiles) {
      const context = { season: 1, episode: 1, profile, filters: { resolution: "any" } };
      const javascript = processReleases(streams, context);
      const input = buildEngineInput(javascript.normalized, context);
      const expected = projectJavaScriptOutput(input);
      const result = await processTorrentioResults(streams, context, {
        runWasm: async () => expected
      });
      const expectedProfile = expected.rankings[{
        "best-overall": "bestOverall",
        "smallest-acceptable": "smallestAcceptable",
        "highest-quality": "highestQuality",
        "most-reliable": "mostReliable"
      }[profile]];

      assert.deepEqual(result.ranked.map(release => release.candidateId), expected.rankedIds, profile);
      assert.deepEqual(result.ranked.map(release => release.score), expectedProfile.map(item => item.score), profile);
      assert.deepEqual(result.ranked.map(release => release.scoreBreakdown), expectedProfile.map(item => item.scoreBreakdown), profile);
      assert.deepEqual(result.recommendations.bestOverall?.candidateId ?? null, expected.recommendations.bestOverall, profile);
    }
  });
});

test("fractional byte limits that cannot be represented in the contract fail closed to actual JavaScript semantics", async () => {
  const fractionalStreams = [{
    title: "Example S01E01 1080p WEB-DL 200 B 👤 5",
    infoHash: "d".repeat(40),
    fileIdx: 0
  }];
  const context = {
    season: 1,
    episode: 1,
    filters: { resolution: "any", maxSizeBytes: 107.3741824 }
  };
  await withMode("wasm", async () => {
    const expected = processReleases(fractionalStreams, context);
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await processTorrentioResults(fractionalStreams, context, {
        runWasm: async input => projectJavaScriptOutput(input)
      });
      assert.equal(expected.eligible.length, 0);
      assert.deepEqual(result, expected);
    } finally {
      console.warn = originalWarn;
    }
  });
});

test("WASM mismatch in shadow mode cannot change user-facing JavaScript results", async () => {
  await withMode("wasm-shadow", async () => {
    const context = { season: 1, episode: 1, filters: { resolution: "any" } };
    const expected = processReleases(streams, context);
    const result = await processTorrentioResults(streams, context, {
      runWasm: async () => ({}),
      contractOutputsMatch: () => false
    });
    assert.deepEqual(result, expected);
  });
});

test("WASM execution failure falls back to the JavaScript pipeline", async () => {
  await withMode("wasm", async () => {
    const context = { season: 1, episode: 1, filters: { resolution: "any" } };
    const expected = processReleases(streams, context);
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await processTorrentioResults(streams, context, {
        runWasm: async () => { throw new Error("simulated WASM failure"); }
      });
      assert.deepEqual(result, expected);
    } finally {
      console.warn = originalWarn;
    }
  });
});
