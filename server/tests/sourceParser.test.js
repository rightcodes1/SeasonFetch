import test from "node:test";
import assert from "node:assert/strict";
import { has1080p, normalizeStream, parseSeeders } from "../utils/sourceParser.js";

const hashA = "a".repeat(40);
const hashB = "b".repeat(40);

test("recognizes exact 1080p metadata", () => {
  assert.equal(has1080p("1080p WEB-DL"), true);
  assert.equal(has1080p("1080i HDTV"), false);
  assert.equal(has1080p("2160p"), false);
  assert.equal(has1080p("21080p"), false);
});

test("parses structured source metadata without guessing", () => {
  const result = normalizeStream({
    title: "[Judas] Show S01E01 2160p WEB-DL HEVC HDR10",
    infoHash: hashA
  });

  assert.equal(result.resolution, "2160p");
  assert.equal(result.codec, "HEVC");
  assert.equal(result.hdr, "HDR");
  assert.equal(result.audio, null);
  assert.equal(result.audioEvidence, "unverified");
  assert.equal(result.releaseGroup, "Judas");
  assert.equal(result.sizeBytes, null);
  assert.equal(result.seeders, null);
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

test("parses seeder counts while preserving unknown counts", () => {
  assert.equal(parseSeeders("1080p WEB-DL 👤 1,234"), 1234);
  assert.equal(parseSeeders("1080p WEB-DL"), null);
});

test("classifies explicit English and unspecified dual audio as different evidence", () => {
  const english = normalizeStream({ title: "Show 1080p English Dub", infoHash: hashA });
  const dual = normalizeStream({ title: "Show 1080p Dual Audio", infoHash: hashB });

  assert.equal(english.audioEvidence, "explicit-english-dub");
  assert.equal(dual.audioEvidence, "possible-english-audio");
});
