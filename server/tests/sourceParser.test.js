import test from "node:test";
import assert from "node:assert/strict";
import { has1080p, normalizeStream, parseSeeders, selectBestSource } from "../utils/sourceParser.js";

const hashA = "a".repeat(40);
const hashB = "b".repeat(40);

test("accepts 1080p only", () => {
  assert.equal(has1080p("1080p WEB-DL"), true);
  assert.equal(has1080p("1080i HDTV"), false);
  assert.equal(has1080p("2160p"), false);
  assert.equal(has1080p("21080p"), false);
});

test("selects the smallest known 1080p Torrentio source", () => {
  const result = selectBestSource([
    { title: "1080p WEB-DL 2GB", infoHash: hashA },
    { title: "1080p WEB-DL 700MB", infoHash: hashB },
    { title: "720p WEB-DL 300MB", infoHash: "c".repeat(40) }
  ]);

  assert.equal(result.status, "selected");
  assert.equal(result.selected.infoHash, hashB);
});

test("prefers the smallest known size, then most seeders, then 1337x", () => {
  const result = selectBestSource([
    { title: "1080p WEB-DL 200 MB 👤 900 ⚙️ 1337x", infoHash: hashA },
    { title: "1080p WEB-DL 100 MB 👤 50 ⚙️ ThePirateBay", infoHash: hashB },
    { title: "1080p WEB-DL 300 MB 👤 120 ⚙️ 1337x", infoHash: "c".repeat(40) }
  ]);

  assert.equal(parseSeeders("1080p WEB-DL 👤 1,234"), 1234);
  assert.equal(result.selected.infoHash, hashB);
  assert.equal(result.selected.provider, null);
  assert.equal(result.selected.seeders, 50);
});

test("uses 1337x only as a tie-breaker after size and seeders", () => {
  const result = selectBestSource([
    { title: "1080p WEB-DL 100 MB 👤 50 ⚙️ ThePirateBay", infoHash: hashA },
    { title: "1080p WEB-DL 100 MB 👤 50 ⚙️ 1337x", infoHash: hashB }
  ]);

  assert.equal(result.selected.infoHash, hashB);
  assert.equal(result.selected.provider, "1337x");
});

test("supports most-seeders and prefer-1337x presets", () => {
  const streams = [
    { title: "1080p WEB-DL 100 MB 👤 50 ⚙️ ThePirateBay", infoHash: hashA },
    { title: "1080p WEB-DL 200 MB 👤 900 ⚙️ 1337x", infoHash: hashB }
  ];

  assert.equal(selectBestSource(streams, "seeders").selected.infoHash, hashB);
  assert.equal(selectBestSource(streams, "1337x").selected.infoHash, hashB);
  assert.equal(selectBestSource(streams, "unknown").selected.infoHash, hashA);
});

test("supports understandable recommendation outcomes and returns a selection reason", () => {
  const streams = [
    { title: "Show 1080p WEB-DL AVC 900 MB 👤 40", infoHash: hashA },
    { title: "Show 1080p BluRay HEVC 1.2 GB 👤 600", infoHash: hashB }
  ];

  const result = selectBestSource(streams, "most-reliable");
  assert.equal(result.selected.infoHash, hashB);
  assert.match(result.selectionReason, /1080p requirement/);
  assert.equal(result.selected.releaseType, "BluRay");
  assert.equal(result.selected.audioEvidence, "unverified");
});

test("uses seeders when both source sizes are unknown", () => {
  const result = selectBestSource([
    { title: "1080p WEB-DL 👤 30", infoHash: hashA },
    { title: "1080p WEB-DL 👤 600", infoHash: hashB }
  ]);

  assert.equal(result.status, "size-unknown");
  assert.equal(result.selected.infoHash, hashB);
});

test("filters to English dubbed or dual-audio sources only when requested", () => {
  const result = selectBestSource([
    { title: "1080p WEB-DL 700 MB Japanese", infoHash: hashA },
    { title: "1080p WEB-DL 1 GB English Dub", infoHash: hashB },
    { title: "1080p WEB-DL 2 GB Dual Audio", infoHash: "c".repeat(40) }
  ], "default", "english-dubbed-or-dual");

  assert.equal(result.candidates.length, 2);
  assert.equal(result.selected.infoHash, hashB);
  assert.equal(result.selected.audio, "english-dubbed");
});

test("extracts structured resolution, codec, HDR, and keeps ambiguous audio unknown", () => {
  const result = normalizeStream({
    title: "Show S01E01 2160p WEB-DL HEVC HDR10",
    infoHash: hashA
  });

  assert.equal(result.resolution, "2160p");
  assert.equal(result.codec, "HEVC");
  assert.equal(result.hdr, "HDR");
  assert.equal(result.audio, null);
});

test("applies hard resolution, size, seeder, and codec filters before ranking", () => {
  const result = selectBestSource([
    { title: "Show 1080p AVC 2 GB 👤 500", infoHash: hashA },
    { title: "Show 1080p HEVC 700 MB 👤 100", infoHash: hashB },
    { title: "Show 720p HEVC 300 MB 👤 900", infoHash: "c".repeat(40) }
  ], "default", "any", { resolution: "1080p", maxSizeBytes: 1024 ** 3, minSeeders: 50, codec: "HEVC" });

  assert.equal(result.selected.infoHash, hashB);
  assert.equal(result.candidates.length, 1);
});

test("preserves safe source links and file selection in the normalized magnet", () => {
  const result = normalizeStream({
    name: "Torrentio",
    title: "Show S01E01 1080p WEB-DL 1.2 GB",
    infoHash: hashA,
    fileIdx: 3,
    behaviorHints: { filename: "Show.S01E01.1080p.mkv" },
    url: "https://example.test/play/episode",
    externalUrl: "javascript:alert(1)",
    sources: ["tracker:udp://tracker.example.test:1337/announce", "dht:example"]
  });

  assert.equal(result.sourceUrl, "https://example.test/play/episode");
  assert.equal(result.externalUrl, null);
  assert.equal(result.fileIdx, 3);
  assert.equal(result.trackerCount, 1);
  assert.match(result.magnet, /xt=urn%3Abtih%3A/);
  assert.match(result.magnet, /so=3/);
  assert.match(result.magnet, /tr=udp%3A%2F%2Ftracker.example.test%3A1337%2Fannounce/);
});

test("adds valid fallback trackers without putting the hash in a tracker parameter", () => {
  const result = normalizeStream({
    title: "Show S01E01 1080p WEB-DL",
    infoHash: hashB,
    sources: []
  });

  assert.equal(result.fallbackTrackersUsed, true);
  assert.match(result.magnet, /tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce/);
  assert.doesNotMatch(result.magnet, /tr=.*bbbb/);
  assert.doesNotMatch(result.rawMagnet, /tr=/);
});
