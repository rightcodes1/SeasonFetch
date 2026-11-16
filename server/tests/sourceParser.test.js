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

test("prefers 1337x, then most seeders, then smallest known size", () => {
  const result = selectBestSource([
    { title: "1080p WEB-DL 200 MB 👤 900 ⚙️ 1337x", infoHash: hashA },
    { title: "1080p WEB-DL 100 MB 👤 50 ⚙️ ThePirateBay", infoHash: hashB },
    { title: "1080p WEB-DL 300 MB 👤 120 ⚙️ 1337x", infoHash: "c".repeat(40) }
  ]);

  assert.equal(parseSeeders("1080p WEB-DL 👤 1,234"), 1234);
  assert.equal(result.selected.infoHash, hashA);
  assert.equal(result.selected.provider, "1337x");
  assert.equal(result.selected.seeders, 900);
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
