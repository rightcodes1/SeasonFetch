import test from "node:test";
import assert from "node:assert/strict";
import { getEpisodeSources } from "../services/torrentio.js";

const hashA = "a".repeat(40);
const hashB = "b".repeat(40);

function mockTorrentio(streams) {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ streams })
  });
  return () => {
    global.fetch = originalFetch;
  };
}

test("delivered source is exactly the authoritative pipeline recommendation", async () => {
  const restore = mockTorrentio([
    { title: "Show S01E01 1080p WEB-DL 2 GB 👤 20", infoHash: hashA },
    { title: "Show S01E01 1080p WEB-DL 700 MB 👤 100 English Dub", infoHash: hashB }
  ]);

  try {
    const result = await getEpisodeSources("tt1234567", 1, 1, "smallest-acceptable", "any", { resolution: "1080p" });
    assert.equal(result.status, "selected");
    assert.equal(result.selected.infoHash, hashB);
    assert.equal(result.selected.infoHash, result.intelligence.recommendations.smallestAcceptable.infoHash);
    assert.equal(result.sources[0].infoHash, result.selected.infoHash);
  } finally {
    restore();
  }
});

test("mandatory English-only validation rejects generic dual audio before ranking", async () => {
  const restore = mockTorrentio([
    { title: "Show S01E01 1080p WEB-DL 500 MB Dual Audio 👤 900", infoHash: hashA },
    { title: "Show S01E01 1080p WEB-DL 700 MB English Dub 👤 20", infoHash: hashB }
  ]);

  try {
    const result = await getEpisodeSources("tt1234567", 1, 1, "smallest-acceptable", "english-dubbed-only", { resolution: "1080p" });
    assert.equal(result.selected.infoHash, hashB);
    assert.equal(result.intelligence.eligible.length, 1);
    assert.equal(result.intelligence.rejected.length, 1);
    assert.equal(result.intelligence.rejected[0].infoHash, hashA);
  } finally {
    restore();
  }
});

test("no eligible candidate produces no delivered source", async () => {
  const restore = mockTorrentio([
    { title: "Show S01E01 720p WEB-DL 500 MB 👤 900", infoHash: hashA }
  ]);

  try {
    const result = await getEpisodeSources("tt1234567", 1, 1, "best-overall", "any", { resolution: "1080p" });
    assert.equal(result.status, "unavailable");
    assert.equal(result.selected, null);
    assert.equal(result.sources.length, 0);
    assert.equal(result.intelligence.rejected[0].infoHash, hashA);
  } finally {
    restore();
  }
});
