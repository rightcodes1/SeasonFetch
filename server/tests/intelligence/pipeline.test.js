import test from "node:test";
import assert from "node:assert/strict";
import { processReleases } from "../../intelligence/pipeline.js";
import { rankReleases } from "../../intelligence/ranking/rankReleases.js";

const hashA = "a".repeat(40);
const hashB = "b".repeat(40);

test("pipeline preserves missing evidence and produces recommendations", () => {
  const result = processReleases([
    { title: "[GroupA] Show S01E01 1080p WEB-DL HEVC 1 GB 👤 20", infoHash: hashA, fileIdx: 0 },
    { title: "[GroupB] Show S01E01 1080p WEB-DL AVC 700 MB 👤 100 English Dub", infoHash: hashB, fileIdx: 0 }
  ], { season: 1, episode: 1 });

  assert.equal(result.validated.length, 2);
  assert.equal(result.validated[0].audio.classification, "unverified");
  assert.equal(result.validated[1].audio.classification, "explicit-english-dub");
  assert.equal(result.recommendations.bestOverall !== null, true);
  assert.equal(result.duplicateGroups.length, 2);
  assert.equal(result.episode.status, "available");
});

test("pipeline deduplicates equivalent provider records without guessing fields", () => {
  const result = processReleases([
    { title: "Show S01E01 1080p WEB-DL 1 GB", infoHash: hashA, fileIdx: 0 },
    { title: "Show S01E01 1080p WEB-DL 1 GB", infoHash: hashA, fileIdx: 0 }
  ]);

  assert.equal(result.normalized.length, 2);
  assert.equal(result.duplicateGroups.length, 1);
  assert.equal(result.ranked.length, 1);
  assert.equal(result.ranked[0].resolution, "1080p");
  assert.equal(result.ranked[0].audio.classification, "unverified");
});

test("ranking profiles are deterministic and explain their component scores", () => {
  const releases = processReleases([
    { title: "Show 1080p WEB-DL 500 MB 👤 10", infoHash: hashA },
    { title: "Show 1080p WEB-DL HEVC 2 GB 👤 500", infoHash: hashB }
  ]).validated;

  const ranked = rankReleases(releases, "most-reliable");
  assert.equal(ranked[0].infoHash, hashB);
  assert.match(ranked[0].explanation, /quality/);
  assert.equal(typeof ranked[0].score, "number");
});
