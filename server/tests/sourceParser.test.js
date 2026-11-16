import test from "node:test";
import assert from "node:assert/strict";
import { has1080p, selectBestSource } from "../utils/sourceParser.js";

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
