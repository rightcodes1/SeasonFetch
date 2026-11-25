import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCinemetaSearchUrl, cinemeta } from "../../src/services/cinemeta.js";
import { createSearchCoordinator, isAbortError } from "../../src/utils/searchCoordinator.js";
import {
  buildSearchCacheKey,
  createAutocompleteCache,
  filterResultsByMediaType,
  getMediaTypeFallbackLabel,
  normalizeSearchQueryText,
  normalizeSearchResolution,
  resolveChangeSelectionAction
} from "../../src/utils/searchSession.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("cinemeta client builds autocomplete and full search URLs while preserving query punctuation and media type", async t => {
  assert.equal(
    buildCinemetaSearchUrl("  S.W.A.T.  ", undefined, { mode: "autocomplete" }),
    "/api/cinemeta/search?q=S.W.A.T.&mode=autocomplete"
  );
  assert.equal(
    buildCinemetaSearchUrl("Howl's Moving Castle", "movie", { mode: "autocomplete" }),
    "/api/cinemeta/search?q=Howl%27s+Moving+Castle&type=movie&mode=autocomplete"
  );
  assert.equal(
    buildCinemetaSearchUrl("Breaking Bad", undefined, { mode: "full" }),
    "/api/cinemeta/search?q=Breaking+Bad&mode=full"
  );
  assert.equal(
    buildCinemetaSearchUrl("Dune", "movie"),
    "/api/cinemeta/search?q=Dune&type=movie"
  );

  // Verify AbortSignal is forwarded to fetch
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url, signal: init?.signal });
    return Response.json({ results: [], resolution: { mode: "autocomplete", confidence: "none" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const controller = new AbortController();
  await cinemeta.search("Severance", undefined, { mode: "autocomplete", signal: controller.signal });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/api/cinemeta/search?q=Severance&mode=autocomplete");
  assert.equal(seen[0].signal, controller.signal);
});

test("autocomplete cache reuses matching query+mediaType and rejects mismatched queries, media types, stale, or incomplete entries", () => {
  const cache = createAutocompleteCache({ ttlMs: 60_000, maxEntries: 5 });
  const t0 = 1_700_000_000_000;

  assert.equal(normalizeSearchQueryText("  M*A*S*H  "), "M*A*S*H");
  assert.equal(buildSearchCacheKey("  Breaking   Bad ", "series"), "series:breaking bad");
  assert.equal(buildSearchCacheKey("Breaking Bad", "movie"), "movie:breaking bad");

  const bbItem = {
    id: "tt0903747",
    imdbId: "tt0903747",
    title: "Breaking Bad",
    year: "2008-2013",
    rating: "9.5",
    type: "Crime · Drama",
    synopsis: "Teacher",
    genres: ["Crime", "Drama"],
    poster: "https://img/bb.jpg",
    mediaType: "series"
  };

  cache.set("Breaking Bad", "series", {
    results: [bbItem],
    resolution: {
      query: "Breaking Bad",
      normalizedQuery: "breaking bad",
      mediaType: "series",
      mode: "autocomplete",
      confidence: "high",
      exactMatch: true,
      ambiguous: false,
      needsFallback: false,
      yearHint: null
    }
  }, t0);

  // Same normalized query & mediaType reuses cached results and preserves exact 10-field item shape
  const reused = cache.getReusable("  breaking   bad ", "series", t0 + 5_000);
  assert.ok(reusableCheck(reused));
  assert.equal(reused.results[0].imdbId, "tt0903747");
  assert.equal(Object.keys(reused.results[0]).length, 10);
  assert.equal(reused.resolution.confidence, "high");

  // Different query or different mediaType MUST NOT reuse
  assert.equal(cache.getReusable("Breaking In", "series", t0 + 5_000), null);
  assert.equal(cache.getReusable("Breaking Bad", "movie", t0 + 5_000), null);

  // Expired TTL MUST NOT reuse
  assert.equal(cache.getReusable("Breaking Bad", "series", t0 + 61_000), null);

  // Low-confidence / needsFallback autocomplete MUST NOT reuse
  cache.set("the castle", "movie", {
    results: [{ ...bbItem, id: "tt1", imdbId: "tt1", title: "The Cattle", mediaType: "movie" }],
    resolution: { confidence: "low", needsFallback: true, mediaType: "movie", mode: "autocomplete" }
  }, t0);
  assert.equal(cache.getReusable("the castle", "movie", t0 + 1_000), null);

  // Year-hinted query whose autocomplete items lack release years MUST NOT reuse (let full hydration run)
  cache.set("Dune 2021", "movie", {
    results: [{ ...bbItem, id: "tt1160419", imdbId: "tt1160419", title: "Dune", year: null, mediaType: "movie" }],
    resolution: { confidence: "medium", needsFallback: false, yearHint: 2021, mediaType: "movie", mode: "autocomplete" }
  }, t0);
  assert.equal(cache.getReusable("Dune 2021", "movie", t0 + 1_000), null);

  // Older API payload without `resolution` metadata still works gracefully without crashing
  cache.set("Arrival", "movie", {
    results: [{ ...bbItem, id: "tt2543164", imdbId: "tt2543164", title: "Arrival", year: "2016", mediaType: "movie" }]
  }, t0);
  const legacyReuse = cache.getReusable("Arrival", "movie", t0 + 1_000);
  assert.ok(legacyReuse);
  assert.equal(legacyReuse.resolution, null);
  assert.equal(legacyReuse.results[0].imdbId, "tt2543164");
});

function reusableCheck(entry) {
  return Boolean(entry && Array.isArray(entry.results) && entry.results.length > 0);
}

test("searchCoordinator aborts outdated requests via AbortController and suppresses stale responses", async () => {
  const coordinator = createSearchCoordinator();
  const events = [];

  let firstSignal = null;
  let resolveFirst;
  const firstPromise = new Promise(resolve => { resolveFirst = resolve; });

  coordinator.schedule(async requestId => {
    const signal = coordinator.getSignal(requestId);
    firstSignal = signal;
    signal.addEventListener("abort", () => events.push("first-aborted"));
    try {
      const value = await firstPromise;
      if (coordinator.isCurrent(requestId)) events.push(`first-applied:${value}`);
    } catch (error) {
      if (!isAbortError(error) && coordinator.isCurrent(requestId)) events.push("first-error");
    }
  }, 5);

  await delay(15);
  assert.equal(firstSignal.aborted, false);

  // Scheduling a newer search aborts the first AbortController immediately
  coordinator.schedule(async requestId => {
    const signal = coordinator.getSignal(requestId);
    assert.equal(signal.aborted, false);
    if (coordinator.isCurrent(requestId)) events.push("second-applied");
  }, 5);

  assert.equal(firstSignal.aborted, true);
  resolveFirst("stale-value");
  await delay(20);

  assert.deepEqual(events, ["first-aborted", "second-applied"]);

  // AbortError helper detects standard AbortError cleanly
  const abortErr = new Error("Aborted");
  abortErr.name = "AbortError";
  assert.equal(isAbortError(abortErr), true);
  assert.equal(isAbortError(new Error("Network error")), false);
});

test("movie labels, media-type filtering, Change movie/series navigation, and missing resolution metadata behave safely", async () => {
  assert.equal(getMediaTypeFallbackLabel({ mediaType: "movie" }, "series"), "Movie");
  assert.equal(getMediaTypeFallbackLabel({}, "movie"), "Movie");
  assert.equal(getMediaTypeFallbackLabel({}, "series"), "Series");

  assert.equal(normalizeSearchResolution(undefined), null);
  assert.equal(normalizeSearchResolution(null), null);
  assert.equal(normalizeSearchResolution("invalid"), null);
  assert.equal(normalizeSearchResolution({ confidence: "weird", mode: "autocomplete" }).confidence, "none");

  const mixed = [
    { id: "tt1", mediaType: "movie" },
    { id: "tt2", mediaType: "series" },
    { id: "tt3" }
  ];
  assert.deepEqual(filterResultsByMediaType(mixed, "movie").map(i => i.id), ["tt1"]);
  assert.deepEqual(filterResultsByMediaType(mixed, "series").map(i => i.id), ["tt2", "tt3"]);

  // Change series / Change movie restores prior search results instead of hardcoded demo SERIES
  const restoreSeries = resolveChangeSelectionAction({
    selectedMediaType: "series",
    query: "Attack on Titan",
    lastSearch: { key: "series:attack on titan", mediaType: "series", results: [{ id: "tt2560140" }], resolution: null }
  });
  assert.equal(restoreSeries.action, "restore-results");
  assert.equal(restoreSeries.results[0].id, "tt2560140");

  // Empty query with no prior search returns cleanly to empty discover state (never demo SERIES or error)
  const emptyMovie = resolveChangeSelectionAction({ selectedMediaType: "movie", query: "", lastSearch: null });
  assert.equal(emptyMovie.action, "return-empty");
  assert.equal(emptyMovie.mediaType, "movie");

  const rerunMovie = resolveChangeSelectionAction({ selectedMediaType: "movie", query: "Arrival", lastSearch: null });
  assert.equal(rerunMovie.action, "run-search");
  assert.equal(rerunMovie.query, "Arrival");

  // App.jsx wiring sanity: autocomplete uses mode: 'autocomplete', no hardcoded `setResults(SERIES)` on Change button, no `|| 'Series'` on cards
  const appSource = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(appSource, /mode:\s*'autocomplete'/);
  assert.match(appSource, /autocompleteCacheRef\.current\.getReusable/);
  assert.match(appSource, /normalizeSearchResolution/);
  assert.match(appSource, /onClick=\{handleChangeSelection\}/);
  assert.doesNotMatch(appSource, /else setResults\(SERIES\)/);
  assert.doesNotMatch(appSource, /series\.type \|\| 'Series'/);
});
