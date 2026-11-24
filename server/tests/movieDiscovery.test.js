import test from "node:test";
import assert from "node:assert/strict";
import app from "../app.js";

const hashA = "a".repeat(40);
const hashB = "b".repeat(40);
const hashC = "c".repeat(40);

async function withServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function mockFetch(t, handler) {
  const originalFetch = global.fetch;
  global.fetch = (input, options) => {
    const url = new URL(input);
    if (url.hostname === "127.0.0.1") return originalFetch(input, options);
    return handler(input, options);
  };
  t.after(() => { global.fetch = originalFetch; });
}

test("movie Cinemeta search uses the movie catalog, filters IDs/types, hydrates metadata, and labels mediaType", async t => {
  const requested = [];
  mockFetch(t, async url => {
    const path = new URL(url).pathname;
    requested.push(path);
    if (path === "/catalog/movie/top/search=arrival.json") {
      return Response.json({ metas: [
        { id: "tt0133093", type: "movie", name: "Arrival", genres: ["Drama", "Sci-Fi"] },
        { id: "tt5555555", type: "series", name: "Wrong type" },
        { id: "not-imdb", type: "movie", name: "Bad ID" }
      ] });
    }
    if (path === "/meta/movie/tt0133093.json") {
      return Response.json({ meta: { id: "tt0133093", type: "movie", name: "Arrival (2016)", year: "2016", genres: ["Drama", "Sci-Fi"], imdbRating: "7.9", description: "A linguist makes contact.", poster: "https://image.test/arrival.jpg" } });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });

  const base = await withServer(t);
  const response = await fetch(`${base}/api/cinemeta/search?q=arrival&type=movie`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  assert.deepEqual(body.results[0], {
    id: "tt0133093",
    imdbId: "tt0133093",
    title: "Arrival (2016)",
    year: "2016",
    rating: "7.9",
    type: "Drama · Sci-Fi",
    synopsis: "A linguist makes contact.",
    genres: ["Drama", "Sci-Fi"],
    poster: "https://image.test/arrival.jpg",
    mediaType: "movie"
  });
  assert.deepEqual(requested, ["/catalog/movie/top/search=arrival.json", "/meta/movie/tt0133093.json"]);
});

test("movie metadata detail validates IMDb IDs and requests typed Cinemeta metadata", async t => {
  const requested = [];
  mockFetch(t, async url => {
    requested.push(new URL(url).pathname);
    return Response.json({ meta: { id: "tt1234567", type: "movie", name: "Film", genres: ["Thriller"] } });
  });

  const base = await withServer(t);
  const invalid = await fetch(`${base}/api/cinemeta/movie/ttbad`);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "Invalid movie IMDb ID." });
  assert.deepEqual(requested, []);

  const valid = await fetch(`${base}/api/cinemeta/movie/tt1234567`);
  assert.equal(valid.status, 200);
  const body = await valid.json();
  assert.equal(body.movie.imdbId, "tt1234567");
  assert.equal(body.movie.mediaType, "movie");
  assert.equal(body.movie.type, "Thriller");
  assert.deepEqual(requested, ["/meta/movie/tt1234567.json"]);
});

test("search defaults to series, retains genre display type, and rejects unsupported media types", async t => {
  const requested = [];
  mockFetch(t, async url => {
    const path = new URL(url).pathname;
    requested.push(path);
    if (path === "/catalog/series/top/search=arcane.json") {
      return Response.json({ metas: [{ id: "tt1111111", type: "series", name: "Arcane", genres: ["Animation", "Action"] }] });
    }
    if (path === "/meta/series/tt1111111.json") {
      return Response.json({ meta: { id: "tt1111111", type: "series", name: "Arcane", genres: ["Animation", "Action"] } });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });

  const base = await withServer(t);
  const defaultResponse = await fetch(`${base}/api/cinemeta/search?q=arcane`);
  assert.equal(defaultResponse.status, 200);
  const item = (await defaultResponse.json()).results[0];
  assert.equal(item.mediaType, "series");
  assert.equal(item.type, "Animation · Action");
  assert.deepEqual(requested, ["/catalog/series/top/search=arcane.json", "/meta/series/tt1111111.json"]);

  const unsupported = await fetch(`${base}/api/cinemeta/search?q=arcane&type=anime`);
  assert.equal(unsupported.status, 400);
});

test("Torrentio movie endpoint uses the movie URL, ranks candidates, filters audio, and returns selectable magnets", async t => {
  const requested = [];
  mockFetch(t, async url => {
    requested.push(new URL(url).pathname);
    return Response.json({ streams: [
      { title: "Arrival 2016 1080p WEB-DL 500 MB English Dub 👤 25", infoHash: hashA },
      { title: "Arrival 2016 1080p WEB-DL 700 MB Dual Audio 👤 900", infoHash: hashB },
      { title: "Arrival 2016 1080p WEB-DL 350 MB 👤 50", infoHash: hashC }
    ] });
  });

  const base = await withServer(t);
  const response = await fetch(`${base}/api/torrentio/movie/tt2543164?preference=smallest-acceptable&audio=english-dubbed-only&resolution=1080p`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.provider, "torrentio");
  assert.equal(body.mediaType, "movie");
  assert.equal(body.movieId, "tt2543164");
  assert.equal(body.preference, "smallest-acceptable");
  assert.equal(body.audioMode, "english-dubbed-only");
  assert.equal(body.status, "selected");
  assert.equal(body.selected.infoHash, hashA);
  assert.match(body.selected.magnet, /^magnet:\?/);
  assert.equal(body.sources.length, 1);
  assert.equal(body.sources[0].infoHash, hashA);
  assert.equal(Object.hasOwn(body.selected, "season"), false);
  assert.equal(Object.hasOwn(body.selected, "episode"), false);
  assert.equal(Object.hasOwn(body.intelligence.ranked[0], "season"), false);
  assert.equal(Object.hasOwn(body.intelligence.ranked[0], "episode"), false);
  assert.equal(body.intelligence.rejected.length, 2);
  assert.deepEqual(requested, ["/stream/movie/tt2543164.json"]);
});

test("Torrentio movie applies codec/size/seeder filters and validates IDs and numeric options", async t => {
  const requested = [];
  mockFetch(t, async url => {
    requested.push(new URL(url).pathname);
    return Response.json({ streams: [
      { title: "Film 1080p WEB-DL HEVC 600 MB 👤 40", infoHash: hashA },
      { title: "Film 1080p WEB-DL HEVC 1.5 GB 👤 100", infoHash: hashB },
      { title: "Film 1080p WEB-DL H.264 400 MB 👤 500", infoHash: hashC }
    ] });
  });

  const base = await withServer(t);
  const filtered = await fetch(`${base}/api/torrentio/movie/tt7654321?resolution=1080p&codec=HEVC&maxSizeGb=1&minSeeders=30`);
  assert.equal(filtered.status, 200);
  const body = await filtered.json();
  assert.equal(body.filters.codec, "HEVC");
  assert.equal(body.filters.maxSizeBytes, 1024 ** 3);
  assert.equal(body.selected.infoHash, hashA);
  assert.equal(body.sources.length, 1);

  const invalidId = await fetch(`${base}/api/torrentio/movie/123`);
  assert.equal(invalidId.status, 400);
  const invalidFilter = await fetch(`${base}/api/torrentio/movie/tt7654321?maxSizeGb=0`);
  assert.equal(invalidFilter.status, 400);
  assert.equal(requested.length, 1);
});

test("Anime-like episodic series still uses series URL and accepts dubbed or dual audio", async t => {
  const requested = [];
  mockFetch(t, async url => {
    requested.push(new URL(url).pathname);
    return Response.json({ streams: [
      { title: "[GroupA] KonoSuba S01E01 1080p WEB-DL 650 MB Dual Audio 👤 80", infoHash: hashA },
      { title: "[GroupB] KonoSuba S01E01 1080p WEB-DL 700 MB English Dub 👤 30", infoHash: hashB }
    ] });
  });

  const base = await withServer(t);
  const response = await fetch(`${base}/api/torrentio/season/tt5550001/1?episodes=1&audio=english-dubbed-or-dual&resolution=1080p`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].status, "selected");
  assert.equal(body.results[0].intelligence.eligible.length, 2);
  assert.deepEqual(new Set(body.results[0].intelligence.eligible.map(release => release.audio.classification)), new Set(["explicit-english-dub", "possible-english-audio"]));
  assert.equal(body.results[0].intelligence.ranked[0].season, 1);
  assert.equal(body.results[0].intelligence.ranked[0].episode, 1);
  assert.deepEqual(requested, ["/stream/series/tt5550001%3A1%3A1.json"]);
});
