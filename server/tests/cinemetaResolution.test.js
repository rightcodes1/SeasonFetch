import test from "node:test";
import assert from "node:assert/strict";
import app from "../app.js";
import {
  CINEMETA_CACHE_CONFIG,
  clearCinemetaCache,
  getCinemetaCacheStats,
  searchCinemeta,
  searchCinemetaWithResolution,
  searchMovies,
  searchSeries
} from "../services/cinemeta.js";

const EXPECTED_PUBLIC_KEYS = [
  "genres",
  "id",
  "imdbId",
  "mediaType",
  "poster",
  "rating",
  "synopsis",
  "title",
  "type",
  "year"
];

function assertExactPublicShape(item) {
  assert.deepEqual(Object.keys(item).sort(), EXPECTED_PUBLIC_KEYS);
}

async function withServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function mockUpstreamFetch(t, handler) {
  clearCinemetaCache();
  const originalFetch = global.fetch;
  global.fetch = (input, options) => {
    const url = new URL(input);
    if (url.hostname === "127.0.0.1") return originalFetch(input, options);
    return handler(input, options);
  };
  t.after(() => {
    global.fetch = originalFetch;
    clearCinemetaCache();
  });
}

test("exact match preserves exact 10-field results[] contract and adds top-level resolution metadata", async t => {
  const requested = [];
  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    requested.push(path);
    if (path === "/catalog/series/top/search=breaking%20bad.json") {
      return Response.json({
        metas: [
          { id: "tt9000001", type: "series", name: "Breaking Bad: The Documentary", year: "2013", genres: ["Documentary"] },
          { id: "tt0903747", type: "series", name: "Breaking Bad", year: "2008-2013", genres: ["Crime", "Drama"] }
        ]
      });
    }
    if (path === "/meta/series/tt0903747.json") {
      return Response.json({
        meta: {
          id: "tt0903747",
          type: "series",
          name: "Breaking Bad",
          year: "2008-2013",
          imdbRating: "9.5",
          genres: ["Crime", "Drama", "Thriller"],
          description: "A chemistry teacher turns to manufacturing.",
          poster: "https://img.test/bb.jpg"
        }
      });
    }
    if (path === "/meta/series/tt9000001.json") {
      return Response.json({
        meta: {
          id: "tt9000001",
          type: "series",
          name: "Breaking Bad: The Documentary",
          year: "2013",
          imdbRating: "7.2",
          genres: ["Documentary"],
          description: "Documentary.",
          poster: "https://img.test/bbdoc.jpg"
        }
      });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  });

  const base = await withServer(t);
  const res = await fetch(`${base}/api/cinemeta/search?q=Breaking%20Bad`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.results.length, 2);
  for (const item of body.results) assertExactPublicShape(item);
  assert.equal(body.results[0].imdbId, "tt0903747");
  assert.equal(body.results[0].rating, "9.5");
  assert.equal(body.results[0].type, "Crime · Drama");

  assert.equal(body.resolution.confidence, "high");
  assert.equal(body.resolution.exactMatch, true);
  assert.equal(body.resolution.ambiguous, false);
  assert.equal(body.resolution.selectedCandidateId, "tt0903747");
  assert.equal(body.resolution.needsFallback, false);
  assert.equal(body.resolution.mode, "full");
  assert.equal(body.resolution.hydratedCount, 2);
  assert.deepEqual(body.resolution.duplicateIdConflicts, []);

  // Backward-compatible array-returning service helpers still work directly
  const seriesArr = await searchSeries("Breaking Bad");
  assert.ok(Array.isArray(seriesArr));
  assert.equal(seriesArr[0].imdbId, "tt0903747");
  assertExactPublicShape(seriesArr[0]);
  const genericArr = await searchCinemeta("Breaking Bad", "series");
  assert.ok(Array.isArray(genericArr));
  assert.equal(genericArr[0].imdbId, "tt0903747");
});

test("curated anime alias resolves on primary variant and short-circuits redundant catalog calls", async t => {
  const catalogCalls = [];
  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    if (path.startsWith("/catalog/")) {
      catalogCalls.push(path);
      if (path === "/catalog/series/top/search=Attack%20on%20Titan.json") {
        return Response.json({
          metas: [
            { id: "tt2560140", type: "series", name: "Attack on Titan", year: "2013-2023", genres: ["Animation", "Action"] }
          ]
        });
      }
      return Response.json({ metas: [] });
    }
    if (path === "/meta/series/tt2560140.json") {
      return Response.json({
        meta: {
          id: "tt2560140",
          type: "series",
          name: "Attack on Titan",
          year: "2013-2023",
          imdbRating: "9.1",
          genres: ["Animation", "Action"],
          description: "Humanity vs Titans.",
          poster: "https://img.test/aot.jpg"
        }
      });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  });

  const { results, resolution } = await searchCinemetaWithResolution("Shingeki no Kyojin", "series");
  assert.equal(results.length, 1);
  assertExactPublicShape(results[0]);
  assert.equal(results[0].imdbId, "tt2560140");
  assert.equal(resolution.confidence, "high");
  assert.equal(resolution.selectedCandidateId, "tt2560140");
  assert.deepEqual(resolution.aliasUsed, { id: "attack-on-titan", canonicalTitle: "Attack on Titan" });
  // Short-circuited after primary alias variant — never queried raw "shingeki no kyojin"
  assert.deepEqual(catalogCalls, ["/catalog/series/top/search=Attack%20on%20Titan.json"]);
});

test("remake disambiguation uses post-hydration year metadata and flags substantial year mismatches as low confidence", async t => {
  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    if (path === "/catalog/movie/top/search=dune.json") {
      // Catalog omits years; hydration provides them
      return Response.json({
        metas: [
          { id: "tt0087182", type: "movie", name: "Dune" },
          { id: "tt1160419", type: "movie", name: "Dune" }
        ]
      });
    }
    if (path === "/catalog/movie/top/search=dune%202021.json") {
      return Response.json({ metas: [] });
    }
    if (path === "/meta/movie/tt0087182.json") {
      return Response.json({ meta: { id: "tt0087182", type: "movie", name: "Dune", year: "1984", imdbRating: "6.3", poster: "https://img/d84.jpg" } });
    }
    if (path === "/meta/movie/tt1160419.json") {
      return Response.json({ meta: { id: "tt1160419", type: "movie", name: "Dune", year: "2021", imdbRating: "8.0", poster: "https://img/d21.jpg" } });
    }
    if (path === "/catalog/movie/top/search=oldboy.json" || path === "/catalog/movie/top/search=oldboy%202022.json") {
      return Response.json({
        metas: [{ id: "tt0364569", type: "movie", name: "Oldboy", year: "2003" }]
      });
    }
    if (path === "/meta/movie/tt0364569.json") {
      return Response.json({ meta: { id: "tt0364569", type: "movie", name: "Oldboy", year: "2003", imdbRating: "8.3" } });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  });

  // Without year -> ambiguous, both preserved
  const noYear = await searchCinemetaWithResolution("Dune", "movie");
  assert.equal(noYear.results.length, 2);
  assert.equal(noYear.resolution.ambiguous, true);
  assert.equal(noYear.resolution.selectedCandidateId, null);
  assert.equal(noYear.resolution.confidence, "medium");

  // With year 2021 -> hydration populates years and post-hydration re-rank resolves Dune (2021) at high
  const with2021 = await searchCinemetaWithResolution("Dune 2021", "movie");
  assert.equal(with2021.results[0].imdbId, "tt1160419");
  assert.equal(with2021.resolution.ambiguous, false);
  assert.equal(with2021.resolution.confidence, "high");
  assert.equal(with2021.resolution.selectedCandidateId, "tt1160419");

  // Substantial year mismatch -> candidate preserved, low confidence + needsFallback=true + no auto-selection
  const mismatch = await searchCinemetaWithResolution("Oldboy 2022", "movie");
  assert.equal(mismatch.results.length, 1);
  assert.equal(mismatch.results[0].imdbId, "tt0364569");
  assert.equal(mismatch.resolution.confidence, "low");
  assert.equal(mismatch.resolution.selectedCandidateId, null);
  assert.equal(mismatch.resolution.needsFallback, true);
});

test("ambiguous franchise aliases stay ambiguous without year and disambiguate cleanly with year", async t => {
  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    if (path.startsWith("/catalog/movie/")) {
      return Response.json({
        metas: [
          { id: "tt0120737", type: "movie", name: "The Lord of the Rings: The Fellowship of the Ring", year: "2001" },
          { id: "tt0167261", type: "movie", name: "The Lord of the Rings: The Two Towers", year: "2002" },
          { id: "tt0167260", type: "movie", name: "The Lord of the Rings: The Return of the King", year: "2003" }
        ]
      });
    }
    const id = path.split("/").pop().replace(".json", "");
    const map = {
      tt0120737: { id: "tt0120737", type: "movie", name: "The Lord of the Rings: The Fellowship of the Ring", year: "2001", imdbRating: "8.9" },
      tt0167261: { id: "tt0167261", type: "movie", name: "The Lord of the Rings: The Two Towers", year: "2002", imdbRating: "8.8" },
      tt0167260: { id: "tt0167260", type: "movie", name: "The Lord of the Rings: The Return of the King", year: "2003", imdbRating: "9.0" }
    };
    return Response.json({ meta: map[id] });
  });

  const lotr = await searchCinemetaWithResolution("LOTR", "movie");
  assert.equal(lotr.results.length, 3);
  assert.equal(lotr.resolution.ambiguous, true);
  assert.equal(lotr.resolution.selectedCandidateId, null);
  assert.equal(lotr.resolution.confidence, "medium");

  const lotr2001 = await searchCinemetaWithResolution("LOTR 2001", "movie");
  assert.equal(lotr2001.resolution.ambiguous, false);
  assert.equal(lotr2001.resolution.confidence, "high");
  assert.equal(lotr2001.resolution.selectedCandidateId, "tt0120737");
  assert.equal(lotr2001.results[0].imdbId, "tt0120737");

  const moviesArr = await searchMovies("LOTR 2001");
  assert.equal(moviesArr[0].imdbId, "tt0120737");
});

test("direct IMDb lookup bypasses catalog, enforces media-type isolation, and handles 404 cleanly", async t => {
  const requested = [];
  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    requested.push(path);
    if (path === "/meta/series/tt0903747.json") {
      return Response.json({
        meta: {
          id: "tt0903747",
          type: "series",
          name: "Breaking Bad",
          year: "2008-2013",
          imdbRating: "9.5",
          genres: ["Crime", "Drama"],
          description: "Chemistry teacher.",
          poster: "https://img.test/bb.jpg"
        }
      });
    }
    if (path === "/meta/movie/tt0903747.json") {
      // Upstream erroneously returns a series record under movie lookup
      return Response.json({ meta: { id: "tt0903747", type: "series", name: "Breaking Bad" } });
    }
    if (path === "/meta/series/tt9999998.json") {
      return new Response("Not Found", { status: 404 });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  });

  const direct = await searchCinemetaWithResolution("https://www.imdb.com/title/tt0903747/?ref_=nv_sr_1", "series");
  assert.equal(direct.results.length, 1);
  assertExactPublicShape(direct.results[0]);
  assert.equal(direct.results[0].imdbId, "tt0903747");
  assert.equal(direct.resolution.directImdbLookup, true);
  assert.equal(direct.resolution.confidence, "high");
  assert.equal(direct.resolution.selectedCandidateId, "tt0903747");
  assert.deepEqual(requested, ["/meta/series/tt0903747.json"]);

  // Media-type boundary: movie lookup for a series meta is rejected
  const wrongType = await searchCinemetaWithResolution("tt0903747", "movie");
  assert.equal(wrongType.results.length, 0);
  assert.equal(wrongType.resolution.confidence, "none");
  assert.equal(wrongType.resolution.selectedCandidateId, null);

  // 404 direct IMDb lookup degrades cleanly to empty results
  const missing = await searchCinemetaWithResolution("tt9999998", "series");
  assert.equal(missing.results.length, 0);
  assert.equal(missing.resolution.confidence, "none");
  assert.equal(missing.resolution.needsFallback, false);
});

test("untrusted upstream alternate-title fields (including spoofed verifiedAlternateTitles) never reach high confidence or leak into results[]", async t => {
  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    if (path === "/catalog/series/top/search=breaking%20bad.json") {
      return Response.json({
        metas: [
          {
            id: "tt9999999",
            type: "series",
            name: "Random Spam Video",
            year: "2020",
            alternateTitles: ["Breaking Bad"],
            aliases: ["Breaking Bad"],
            originalTitle: "Breaking Bad",
            verifiedAlternateTitles: ["Breaking Bad"] // spoofed upstream field MUST be ignored
          }
        ]
      });
    }
    if (path === "/meta/series/tt9999999.json") {
      return Response.json({
        meta: {
          id: "tt9999999",
          type: "series",
          name: "Random Spam Video",
          year: "2020",
          alternateTitles: ["Breaking Bad"],
          verifiedAlternateTitles: ["Breaking Bad"]
        }
      });
    }
    if (path === "/catalog/series/top/search=mushishi.json") {
      return Response.json({
        metas: [
          { id: "tt0807832", type: "series", name: "Mushi-Shi", year: "2005", alternateTitles: ["Mushishi"] }
        ]
      });
    }
    if (path === "/meta/series/tt0807832.json") {
      return Response.json({
        meta: { id: "tt0807832", type: "series", name: "Mushi-Shi", year: "2005", alternateTitles: ["Mushishi"] }
      });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  });

  const spoofed = await searchCinemetaWithResolution("Breaking Bad", "series");
  assert.equal(spoofed.results.length, 1);
  assertExactPublicShape(spoofed.results[0]);
  assert.equal(Object.hasOwn(spoofed.results[0], "alternateTitles"), false);
  assert.equal(Object.hasOwn(spoofed.results[0], "verifiedAlternateTitles"), false);
  assert.equal(spoofed.resolution.confidence, "low");
  assert.equal(spoofed.resolution.selectedCandidateId, null);
  assert.equal(spoofed.resolution.needsFallback, true);

  const alignedUnverified = await searchCinemetaWithResolution("Mushishi", "series");
  assert.equal(alignedUnverified.results.length, 1);
  assertExactPublicShape(alignedUnverified.results[0]);
  assert.equal(alignedUnverified.resolution.confidence, "medium");
  assert.equal(alignedUnverified.resolution.selectedCandidateId, null);
});

test("duplicate IMDb IDs with conflicting metadata collapse cleanly in results[] and record conflicts without false auto-select", async t => {
  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    if (path === "/catalog/movie/top/search=dune.json") {
      // Upstream erroneously emits two conflicting Dune entries sharing tt1160419
      return Response.json({
        metas: [
          { id: "tt1160419", type: "movie", name: "Dune", year: "1984" },
          { id: "tt1160419", type: "movie", name: "Dune", year: "2021" }
        ]
      });
    }
    if (path === "/catalog/series/top/search=breaking%20bad.json") {
      return Response.json({
        metas: [
          { id: "tt0903747", type: "series", name: "Breaking Bad", year: "2008" },
          { id: "tt0903747", type: "series", name: "El Camino", year: "2019" }
        ]
      });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  });

  // Autocomplete tests conflict handling directly on catalog payloads
  const conflictingRemake = await searchCinemetaWithResolution("Dune", "movie", { mode: "autocomplete" });
  assert.equal(conflictingRemake.results.length, 1);
  assert.equal(conflictingRemake.results[0].imdbId, "tt1160419");
  assert.equal(conflictingRemake.resolution.ambiguous, true);
  assert.equal(conflictingRemake.resolution.selectedCandidateId, null);
  assert.equal(conflictingRemake.resolution.confidence, "medium");
  assert.equal(conflictingRemake.resolution.duplicateIdConflicts.length, 1);
  assert.equal(conflictingRemake.resolution.duplicateIdConflicts[0].imdbId, "tt1160419");

  const conflictingTitle = await searchCinemetaWithResolution("Breaking Bad", "series", { mode: "autocomplete" });
  assert.equal(conflictingTitle.results.length, 1);
  assert.equal(conflictingTitle.results[0].title, "Breaking Bad");
  assert.equal(conflictingTitle.resolution.duplicateIdConflicts.length, 1);
  assert.deepEqual(conflictingTitle.resolution.duplicateIdConflicts[0], {
    imdbId: "tt0903747",
    keptTitle: "Breaking Bad",
    discardedTitles: ["El Camino"]
  });
});

test("autocomplete performs zero hydration, full search hydrates at most 5 candidates with max concurrency 3, and invalid mode returns 400", async t => {
  const catalogCalls = [];
  const metaCalls = [];
  let inFlightMetaNow = 0;
  let peakMetaConcurrency = 0;

  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    if (path === "/catalog/series/top/search=star.json") {
      catalogCalls.push(path);
      return Response.json({
        metas: Array.from({ length: 12 }, (_, i) => ({
          id: `tt20000${String(i).padStart(2, "0")}`,
          type: "series",
          name: i === 0 ? "Star" : `Star Show ${i}`,
          year: String(2010 + i)
        }))
      });
    }
    if (path.startsWith("/meta/series/")) {
      metaCalls.push(path);
      inFlightMetaNow += 1;
      peakMetaConcurrency = Math.max(peakMetaConcurrency, inFlightMetaNow);
      await new Promise(resolve => setTimeout(resolve, 15));
      inFlightMetaNow -= 1;
      const id = path.split("/").pop().replace(".json", "");
      return Response.json({ meta: { id, type: "series", name: `Hydrated ${id}`, year: "2020", imdbRating: "8.0" } });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  });

  const base = await withServer(t);

  // Invalid mode returns 400
  const invalidMode = await fetch(`${base}/api/cinemeta/search?q=star&mode=bogus`);
  assert.equal(invalidMode.status, 400);

  // Autocomplete mode: 0 meta hydration calls, results capped to 8
  const autoRes = await fetch(`${base}/api/cinemeta/search?q=star&mode=autocomplete`);
  assert.equal(autoRes.status, 200);
  const autoBody = await autoRes.json();
  assert.equal(autoBody.results.length, CINEMETA_CACHE_CONFIG.autocompleteLimit);
  assert.equal(autoBody.resolution.mode, "autocomplete");
  assert.equal(autoBody.resolution.hydratedCount, 0);
  assert.equal(metaCalls.length, 0);

  // Full mode: reuses cached catalog variant, hydrates ONLY top 5 with max concurrency 3
  const fullRes = await fetch(`${base}/api/cinemeta/search?q=star&mode=full`);
  assert.equal(fullRes.status, 200);
  const fullBody = await fullRes.json();
  assert.equal(fullBody.results.length, 12);
  assert.equal(catalogCalls.length, 1);
  assert.equal(metaCalls.length, CINEMETA_CACHE_CONFIG.hydration.fullModeMaxCandidates);
  assert.equal(fullBody.resolution.hydratedCount, CINEMETA_CACHE_CONFIG.hydration.fullModeMaxCandidates);
  assert.ok(
    peakMetaConcurrency >= 2 && peakMetaConcurrency <= CINEMETA_CACHE_CONFIG.hydration.concurrency,
    `Expected peak meta concurrency in [2, ${CINEMETA_CACHE_CONFIG.hydration.concurrency}], got ${peakMetaConcurrency}`
  );
});

test("LRU + TTL cache, in-flight coalescing, stale-on-error fallback, implausible zero-fetch, and upstream error recovery", async t => {
  let upstreamCount = 0;
  let failUpstream = false;

  mockUpstreamFetch(t, async url => {
    upstreamCount += 1;
    const path = new URL(url).pathname;
    if (failUpstream) {
      return new Response("Upstream down", { status: 503 });
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    if (path === "/catalog/series/top/search=severance.json") {
      return Response.json({
        metas: [{ id: "tt11280740", type: "series", name: "Severance", year: "2022" }]
      });
    }
    if (path === "/meta/series/tt11280740.json") {
      return Response.json({
        meta: { id: "tt11280740", type: "series", name: "Severance", year: "2022", imdbRating: "8.7" }
      });
    }
    if (path === "/catalog/movie/top/search=wonder%20woman.json") {
      // Simulate variant #1 failing while variant #2 succeeds
      return new Response("Temp 502", { status: 502 });
    }
    if (path === "/catalog/movie/top/search=wonder%20woman%201984.json") {
      return Response.json({
        metas: [{ id: "tt7126948", type: "movie", name: "Wonder Woman 1984", year: "2020" }]
      });
    }
    if (path === "/meta/movie/tt7126948.json") {
      return Response.json({
        meta: { id: "tt7126948", type: "movie", name: "Wonder Woman 1984", year: "2020", imdbRating: "5.4" }
      });
    }
    if (path === "/catalog/series/top/search=%E9%80%B2%E6%92%83%E3%81%AE%E5%B7%A8%E4%BA%BA.json") {
      return Response.json({
        metas: [{ id: "tt2560140", type: "series", name: "Attack on Titan", year: "2013" }]
      });
    }
    if (path === "/meta/series/tt2560140.json") {
      return Response.json({
        meta: { id: "tt2560140", type: "series", name: "Attack on Titan", year: "2013-2023", imdbRating: "9.1" }
      });
    }
    return Response.json({ metas: [] });
  });

  // Gibberish triggers 0 upstream requests
  const gibberish = await searchCinemetaWithResolution("zxqwkjhgf", "series");
  assert.equal(gibberish.results.length, 0);
  assert.equal(gibberish.resolution.needsFallback, false);
  assert.equal(upstreamCount, 0);

  // Native-language / non-Latin queries pass raw script to Cinemeta while staying conservative (needsFallback=true, no auto-select)
  const nonLatin = await searchCinemetaWithResolution("進撃の巨人", "series");
  assert.equal(nonLatin.results.length, 1);
  assert.equal(nonLatin.results[0].imdbId, "tt2560140");
  assert.equal(nonLatin.resolution.confidence, "low");
  assert.equal(nonLatin.resolution.selectedCandidateId, null);
  assert.equal(nonLatin.resolution.needsFallback, true);
  assert.deepEqual(nonLatin.resolution.searchedQueries, ["進撃の巨人"]);
  const afterNonLatinCount = upstreamCount;

  // 5 concurrent identical searches coalesce into 1 catalog + 1 meta request (2 upstream calls total)
  const t0 = 1_700_000_000_000;
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () => searchCinemetaWithResolution("Severance", "series", { now: t0 }))
  );
  assert.equal(upstreamCount - afterNonLatinCount, 2);
  for (const res of concurrent) {
    assert.equal(res.results[0].imdbId, "tt11280740");
    assert.equal(res.resolution.confidence, "high");
  }
  assert.equal(getCinemetaCacheStats().searchCoalesced, 4);

  // Subsequent request within TTL hits cache with 0 additional upstream requests
  const cached = await searchCinemetaWithResolution("Severance", "series", { now: t0 + 60_000 });
  assert.equal(upstreamCount - afterNonLatinCount, 2);
  assert.equal(cached.resolution.cache.hit, true);
  assert.equal(cached.resolution.cache.stale, false);
  assert.equal(cached.resolution.cache.upstreamRequests, 0);

  // At 6 min (past search 5m TTL, still within catalog 10m & meta 15m fresh TTLs),
  // layered catalog/meta caches satisfy the search with 0 upstream requests even while upstream is down.
  failUpstream = true;
  const layeredFresh = await searchCinemetaWithResolution("Severance", "series", { now: t0 + 6 * 60_000 });
  assert.equal(layeredFresh.results[0].imdbId, "tt11280740");
  assert.equal(layeredFresh.resolution.cache.stale, false);
  assert.equal(layeredFresh.resolution.cache.upstreamRequests, 0);

  // At 16 min (past all fresh TTLs: search 5m, catalog 10m, meta 15m; within 30m stale TTL),
  // failing upstream falls back to stale cached data gracefully.
  const stale = await searchCinemetaWithResolution("Severance", "series", { now: t0 + 16 * 60_000 });
  assert.equal(stale.results[0].imdbId, "tt11280740");
  assert.equal(stale.resolution.cache.stale, true);

  // Beyond stale TTL (40 min > 30 min from last refresh) and upstream fails -> rejects cleanly
  await assert.rejects(
    () => searchCinemetaWithResolution("Severance", "series", { now: t0 + 40 * 60_000 }),
    /Cinemeta returned HTTP 503/
  );

  // Partial variant failure recovers via variant #2 ("Wonder Woman 1984")
  failUpstream = false;
  const partialRecovery = await searchCinemetaWithResolution("Wonder Woman 1984", "movie", { now: t0 });
  assert.equal(partialRecovery.results[0].imdbId, "tt7126948");
  assert.equal(partialRecovery.resolution.confidence, "high");

  // Complete upstream failure with no stale cache returns HTTP 502 on route
  failUpstream = true;
  const base = await withServer(t);
  const errRes = await fetch(`${base}/api/cinemeta/search?q=never-cached-title`);
  assert.equal(errRes.status, 502);
  assert.deepEqual(await errRes.json(), { error: "Cinemeta search is unavailable right now." });
});

test("LRU bounds enforce maxEntries, media-type isolation filters cross-type catalog items, and single hydration failure preserves candidate", async t => {
  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    if (path === "/catalog/movie/top/search=shingeki%20no%20kyojin.json") {
      return Response.json({
        metas: [
          { id: "tt2560140", type: "series", name: "Attack on Titan", year: "2013" }, // wrong type -> dropped
          { id: "tt9010001", type: "movie", name: "Attack on Titan Part 1", year: "2015" }
        ]
      });
    }
    if (path === "/meta/movie/tt9010001.json") {
      return new Response("Meta 500", { status: 500 });
    }
    if (path === "/catalog/series/top/search=breking%20bad.json") {
      return Response.json({
        metas: [{ id: "tt0903747", type: "series", name: "Breaking Bad", year: "2008" }]
      });
    }
    if (path === "/meta/series/tt0903747.json") {
      return Response.json({ meta: { id: "tt0903747", type: "series", name: "Breaking Bad", year: "2008", imdbRating: "9.5" } });
    }
    return Response.json({ metas: [] });
  });

  // Movie mode does NOT fire series alias "Shingeki no Kyojin" -> drops series item, preserves movie item despite meta 500
  const movieIsolation = await searchCinemetaWithResolution("Shingeki no Kyojin", "movie");
  assert.equal(movieIsolation.resolution.aliasUsed, null);
  assert.equal(movieIsolation.results.length, 1);
  assert.equal(movieIsolation.results[0].imdbId, "tt9010001");
  assert.equal(movieIsolation.results[0].mediaType, "movie");
  assert.equal(movieIsolation.resolution.hydratedCount, 0);
  assert.equal(movieIsolation.resolution.selectedCandidateId, null);

  // Typo query stays medium confidence and never auto-selects
  const typo = await searchCinemetaWithResolution("breking bad", "series");
  assert.equal(typo.results[0].imdbId, "tt0903747");
  assert.equal(typo.resolution.confidence, "medium");
  assert.equal(typo.resolution.selectedCandidateId, null);

  // LRU maxEntries enforcement: insert 215 distinct queries and verify cache sizes never exceed 200
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 215; i += 1) {
    await searchCinemetaWithResolution(`alpha title ${i}`, "series", { mode: "autocomplete", now: t0 + i });
  }
  const stats = getCinemetaCacheStats();
  assert.equal(stats.sizes.catalog, CINEMETA_CACHE_CONFIG.catalog.maxEntries);
  assert.equal(stats.sizes.search, CINEMETA_CACHE_CONFIG.search.maxEntries);
});

test("catalog releaseInfo and released timestamps populate year in autocomplete and survive null-year hydration", async t => {
  mockUpstreamFetch(t, async url => {
    const path = new URL(url).pathname;
    if (path === "/catalog/movie/top/search=dune.json") {
      return Response.json({
        metas: [
          { id: "tt1160419", type: "movie", name: "Dune", releaseInfo: "2021", poster: "https://img/d21.jpg" },
          { id: "tt0087182", type: "movie", name: "Dune", released: "1984-12-14T00:00:00.000Z", poster: "https://img/d84.jpg" }
        ]
      });
    }
    if (path === "/meta/movie/tt1160419.json") {
      // Meta omits year/releaseInfo; hydration must preserve catalog releaseInfo year
      return Response.json({
        meta: { id: "tt1160419", type: "movie", name: "Dune", imdbRating: "8.0" }
      });
    }
    if (path === "/meta/movie/tt0087182.json") {
      return Response.json({
        meta: { id: "tt0087182", type: "movie", name: "Dune", year: "1984", imdbRating: "6.3" }
      });
    }
    return Response.json({ metas: [] });
  });

  // Autocomplete (0 hydration calls) populates years immediately from releaseInfo & released
  const auto = await searchCinemetaWithResolution("Dune", "movie", { mode: "autocomplete" });
  assert.equal(auto.resolution.hydratedCount, 0);
  assert.equal(auto.results[0].year, "2021");
  assert.equal(auto.results[1].year, "1984");
  assertExactPublicShape(auto.results[0]);

  // Full search hydration preserves catalog releaseInfo year even when meta omits year
  const full = await searchCinemetaWithResolution("Dune 2021", "movie", { mode: "full" });
  assert.equal(full.results[0].imdbId, "tt1160419");
  assert.equal(full.results[0].year, "2021");
  assert.equal(full.results[0].rating, "8.0");
  assert.equal(full.resolution.confidence, "high");
  assert.equal(full.resolution.selectedCandidateId, "tt1160419");
});
