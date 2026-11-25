import { parseSearchQuery, rankCandidates } from "./titleResolution.js";

const BASE_URL = (process.env.CINEMETA_BASE_URL || "https://v3-cinemeta.strem.io").replace(/\/+$/, "");
const VALID_MEDIA_TYPES = new Set(["movie", "series"]);
const VALID_SEARCH_MODES = new Set(["full", "autocomplete"]);

export const CINEMETA_CACHE_CONFIG = Object.freeze({
  catalog: Object.freeze({
    maxEntries: 200,
    ttlMs: 10 * 60 * 1000,
    staleTtlMs: 30 * 60 * 1000
  }),
  meta: Object.freeze({
    maxEntries: 300,
    ttlMs: 15 * 60 * 1000,
    staleTtlMs: 60 * 60 * 1000
  }),
  search: Object.freeze({
    maxEntries: 200,
    ttlMs: 5 * 60 * 1000,
    staleTtlMs: 30 * 60 * 1000
  }),
  hydration: Object.freeze({
    fullModeMaxCandidates: 5,
    autocompleteMaxCandidates: 0,
    concurrency: 3
  }),
  variants: Object.freeze({
    fullModeMax: 3,
    autocompleteMax: 2
  }),
  autocompleteLimit: 8
});

class BoundedTtlLruCache {
  constructor({ maxEntries, ttlMs, staleTtlMs }) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.staleTtlMs = Math.max(ttlMs, staleTtlMs);
    this.store = new Map();
  }

  getFresh(key, now = Date.now()) {
    const entry = this.store.get(key);
    if (!entry) return null;
    const age = now - entry.storedAt;
    if (age > this.staleTtlMs) {
      this.store.delete(key);
      return null;
    }
    if (age <= this.ttlMs) {
      // Refresh LRU recency
      this.store.delete(key);
      this.store.set(key, entry);
      return { value: entry.value, stale: false };
    }
    return null;
  }

  getStale(key, now = Date.now()) {
    const entry = this.store.get(key);
    if (!entry) return null;
    const age = now - entry.storedAt;
    if (age > this.staleTtlMs) {
      this.store.delete(key);
      return null;
    }
    return { value: entry.value, stale: true };
  }

  set(key, value, now = Date.now()) {
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, { value, storedAt: now });
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

const catalogCache = new BoundedTtlLruCache(CINEMETA_CACHE_CONFIG.catalog);
const metaCache = new BoundedTtlLruCache(CINEMETA_CACHE_CONFIG.meta);
const searchResultCache = new BoundedTtlLruCache(CINEMETA_CACHE_CONFIG.search);

const inFlightCatalog = new Map();
const inFlightMeta = new Map();
const inFlightSearch = new Map();

const cacheStats = {
  catalogHits: 0,
  catalogMisses: 0,
  catalogStaleHits: 0,
  catalogCoalesced: 0,
  metaHits: 0,
  metaMisses: 0,
  metaStaleHits: 0,
  metaCoalesced: 0,
  searchHits: 0,
  searchMisses: 0,
  searchStaleHits: 0,
  searchCoalesced: 0
};

export function clearCinemetaCache() {
  catalogCache.clear();
  metaCache.clear();
  searchResultCache.clear();
  inFlightCatalog.clear();
  inFlightMeta.clear();
  inFlightSearch.clear();
  for (const key of Object.keys(cacheStats)) cacheStats[key] = 0;
}

export function getCinemetaCacheStats() {
  return {
    ...cacheStats,
    sizes: {
      catalog: catalogCache.size,
      meta: metaCache.size,
      search: searchResultCache.size
    },
    inFlight: {
      catalog: inFlightCatalog.size,
      meta: inFlightMeta.size,
      search: inFlightSearch.size
    },
    config: CINEMETA_CACHE_CONFIG
  };
}

function isValidImdbId(id) {
  return typeof id === "string" && /^tt\d+$/.test(id);
}

async function requestJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "SeasonFetch/1.0" },
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    const wrapped = new Error(error.name === "TimeoutError" ? "Cinemeta request timed out" : "Cinemeta request failed");
    wrapped.statusCode = error.name === "TimeoutError" ? 504 : 502;
    throw wrapped;
  }

  if (!response.ok) {
    const error = new Error(`Cinemeta returned HTTP ${response.status}`);
    error.statusCode = response.status === 404 ? 404 : 502;
    throw error;
  }
  return response.json();
}

function normalizeMetadata(item = {}, mediaType = "series") {
  const genres = Array.isArray(item.genres) ? item.genres.filter(g => typeof g === "string") : [];

  return {
    id: item.id,
    imdbId: item.id,
    title: item.name || "Unknown title",
    year: item.year || null,
    rating: item.imdbRating || item.rating || null,
    // `type` has historically been the genre/display label in this API.
    type: genres.slice(0, 2).join(" · ") || (mediaType === "movie" ? "Movie" : "Series"),
    synopsis: item.description || "",
    genres,
    poster: item.poster || null,
    mediaType
  };
}

function toPublicCandidate(candidate, fallbackMediaType = "series") {
  const mediaType = VALID_MEDIA_TYPES.has(candidate?.mediaType) ? candidate.mediaType : fallbackMediaType;
  const genres = Array.isArray(candidate?.genres) ? [...candidate.genres] : [];
  const id = candidate?.imdbId || candidate?.id;
  return {
    id,
    imdbId: id,
    title: candidate?.title || "Unknown title",
    year: candidate?.year ?? null,
    rating: candidate?.rating ?? null,
    type: candidate?.type || (genres.slice(0, 2).join(" · ") || (mediaType === "movie" ? "Movie" : "Series")),
    synopsis: candidate?.synopsis || "",
    genres,
    poster: candidate?.poster ?? null,
    mediaType
  };
}

// Extract only UNVERIFIED alternate-title hints from raw upstream items for internal ranking.
// Explicitly ignores any `verifiedAlternateTitles` field on upstream payloads so untrusted
// Cinemeta metadata can NEVER qualify for high-confidence automatic selection.
function buildInternalScoringCandidate(rawItem, mediaType) {
  const base = normalizeMetadata(rawItem, mediaType);
  const scoring = { ...base };

  const unverifiedAlts = [];
  const pushStr = value => {
    if (typeof value === "string" && value.trim()) unverifiedAlts.push(value.trim());
  };
  for (const field of ["originalTitle", "originalName"]) {
    pushStr(rawItem?.[field]);
  }
  for (const listField of ["alternateTitles", "aliases", "aka"]) {
    if (Array.isArray(rawItem?.[listField])) {
      for (const entry of rawItem[listField]) pushStr(entry);
    }
  }
  if (unverifiedAlts.length) {
    scoring.alternateTitles = [...new Set(unverifiedAlts)];
  }
  return scoring;
}

function normalizeSeries(item = {}) {
  return normalizeMetadata(item, "series");
}

function normalizeMovie(item = {}) {
  return normalizeMetadata(item, "movie");
}

function cloneSearchPayload(payload) {
  return {
    results: payload.results.map(item => ({ ...item, genres: [...item.genres] })),
    resolution: {
      ...payload.resolution,
      aliasUsed: payload.resolution.aliasUsed ? { ...payload.resolution.aliasUsed } : null,
      searchedQueries: [...payload.resolution.searchedQueries],
      duplicateIdConflicts: payload.resolution.duplicateIdConflicts.map(conflict => ({
        ...conflict,
        discardedTitles: [...conflict.discardedTitles]
      })),
      cache: { ...payload.resolution.cache }
    }
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

async function fetchCatalogVariant(variantQuery, mediaType, now = Date.now()) {
  const key = `${mediaType}:${String(variantQuery || "").trim().toLowerCase()}`;
  const fresh = catalogCache.getFresh(key, now);
  if (fresh) {
    cacheStats.catalogHits += 1;
    return { items: fresh.value, stale: false, upstreamFetched: false };
  }

  if (inFlightCatalog.has(key)) {
    cacheStats.catalogCoalesced += 1;
    const shared = await inFlightCatalog.get(key);
    return { items: shared.items, stale: shared.stale, upstreamFetched: false };
  }

  cacheStats.catalogMisses += 1;
  const promise = (async () => {
    const url = `${BASE_URL}/catalog/${mediaType}/top/search=${encodeURIComponent(variantQuery)}.json`;
    try {
      const data = await requestJson(url);
      const items = (Array.isArray(data?.metas) ? data.metas : [])
        .filter(item => item && item.type === mediaType && isValidImdbId(item.id))
        .map(item => buildInternalScoringCandidate(item, mediaType));
      catalogCache.set(key, items, now);
      return { items, stale: false, upstreamFetched: true };
    } catch (error) {
      const stale = catalogCache.getStale(key, now);
      if (stale) {
        cacheStats.catalogStaleHits += 1;
        return { items: stale.value, stale: true, upstreamFetched: true };
      }
      throw error;
    }
  })();

  inFlightCatalog.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlightCatalog.delete(key);
  }
}

async function fetchRawMeta(imdbId, mediaType, now = Date.now()) {
  const key = `${mediaType}:${imdbId}`;
  const fresh = metaCache.getFresh(key, now);
  if (fresh) {
    cacheStats.metaHits += 1;
    return { meta: fresh.value, stale: false, upstreamFetched: false };
  }

  if (inFlightMeta.has(key)) {
    cacheStats.metaCoalesced += 1;
    const shared = await inFlightMeta.get(key);
    return { meta: shared.meta, stale: shared.stale, upstreamFetched: false };
  }

  cacheStats.metaMisses += 1;
  const promise = (async () => {
    const url = `${BASE_URL}/meta/${mediaType}/${encodeURIComponent(imdbId)}.json`;
    try {
      const data = await requestJson(url);
      const meta = data?.meta && typeof data.meta === "object" ? data.meta : null;
      metaCache.set(key, meta, now);
      return { meta, stale: false, upstreamFetched: true };
    } catch (error) {
      const stale = metaCache.getStale(key, now);
      if (stale) {
        cacheStats.metaStaleHits += 1;
        return { meta: stale.value, stale: true, upstreamFetched: true };
      }
      throw error;
    }
  })();

  inFlightMeta.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlightMeta.delete(key);
  }
}

async function hydrateCandidate(scoringCandidate, mediaType, now) {
  try {
    const { meta, stale, upstreamFetched } = await fetchRawMeta(scoringCandidate.imdbId, mediaType, now);
    if (!meta) {
      return { candidate: scoringCandidate, hydrated: false, stale, upstreamFetched };
    }
    // Preserve strict media-type boundary if upstream meta declares a conflicting type.
    if (VALID_MEDIA_TYPES.has(meta.type) && meta.type !== mediaType) {
      return { candidate: scoringCandidate, hydrated: false, stale, upstreamFetched };
    }
    const hydratedScoring = buildInternalScoringCandidate(meta, mediaType);
    const mergedAlts = [
      ...(Array.isArray(scoringCandidate.alternateTitles) ? scoringCandidate.alternateTitles : []),
      ...(Array.isArray(hydratedScoring.alternateTitles) ? hydratedScoring.alternateTitles : [])
    ];
    const merged = {
      ...scoringCandidate,
      ...hydratedScoring,
      id: scoringCandidate.imdbId,
      imdbId: scoringCandidate.imdbId,
      mediaType
    };
    if (mergedAlts.length) {
      merged.alternateTitles = [...new Set(mergedAlts)];
    }
    return { candidate: merged, hydrated: true, stale, upstreamFetched };
  } catch {
    return { candidate: scoringCandidate, hydrated: false, stale: false, upstreamFetched: true };
  }
}

function finalizePublicResults(outcome, mediaType, limit = null) {
  const seenIds = new Map();
  const publicResults = [];
  const duplicateIdConflicts = [];
  let topIdHasStrongConflict = false;
  const topId = outcome.topCandidate?.imdbId || null;

  for (const entry of outcome.ranked) {
    const id = entry.candidate.imdbId || entry.candidate.id;
    if (!seenIds.has(id)) {
      seenIds.set(id, {
        title: entry.candidate.title,
        score: entry.evidence.score,
        conflictEntry: null
      });
      publicResults.push(toPublicCandidate(entry.candidate, mediaType));
      continue;
    }

    const kept = seenIds.get(id);
    if (!kept.conflictEntry) {
      kept.conflictEntry = {
        imdbId: id,
        keptTitle: kept.title,
        discardedTitles: []
      };
      duplicateIdConflicts.push(kept.conflictEntry);
    }
    kept.conflictEntry.discardedTitles.push(entry.candidate.title || "Unknown title");

    if (id === topId && entry.evidence.score >= 0.55) {
      topIdHasStrongConflict = true;
    }
  }

  let confidence = outcome.confidence;
  let ambiguous = outcome.ambiguous;
  let ambiguityReason = outcome.ambiguityReason;
  let selectedCandidateId = outcome.selectedCandidate ? outcome.selectedCandidate.imdbId : null;
  let exactMatch = outcome.exactMatch;

  if (topIdHasStrongConflict) {
    ambiguous = true;
    if (!ambiguityReason) {
      ambiguityReason = `Conflicting metadata records share IMDb ID ${topId}.`;
    }
    if (confidence === "high") confidence = "medium";
    selectedCandidateId = null;
    exactMatch = false;
  }

  const slicedResults = Number.isInteger(limit) && limit > 0
    ? publicResults.slice(0, limit)
    : publicResults;

  return {
    results: slicedResults,
    confidence,
    exactMatch,
    ambiguous,
    ambiguityReason,
    selectedCandidateId,
    needsFallback: outcome.needsFallback,
    duplicateIdConflicts
  };
}

function buildEmptyResolution(spec, mediaType, mode, { searchedQueries = [], upstreamRequests = 0, stale = false, cacheHit = false } = {}) {
  return {
    results: [],
    resolution: {
      query: spec.rawQuery,
      normalizedQuery: spec.normalizedQuery,
      mediaType,
      mode,
      directImdbLookup: spec.isDirectImdbLookup,
      yearHint: spec.yearHint,
      aliasUsed: spec.aliasMatch ? { id: spec.aliasMatch.id, canonicalTitle: spec.aliasMatch.canonicalTitle } : null,
      searchedQueries,
      confidence: "none",
      exactMatch: false,
      ambiguous: false,
      ambiguityReason: "",
      selectedCandidateId: null,
      needsFallback: Boolean(spec.nonLatinScript),
      hydratedCount: 0,
      duplicateIdConflicts: [],
      cache: {
        hit: cacheHit,
        stale,
        upstreamRequests
      }
    }
  };
}

async function executeResolvedSearch(spec, mediaType, mode, { limit, now }) {
  let upstreamRequests = 0;
  let usedStale = false;

  // 1. Direct IMDb ID or IMDb URL lookup via /meta/{mediaType}/{imdbId}.json
  if (spec.isDirectImdbLookup && spec.imdbId) {
    try {
      const { meta, stale, upstreamFetched } = await fetchRawMeta(spec.imdbId, mediaType, now);
      if (upstreamFetched) upstreamRequests += 1;
      if (stale) usedStale = true;

      if (!meta || (VALID_MEDIA_TYPES.has(meta.type) && meta.type !== mediaType)) {
        return buildEmptyResolution(spec, mediaType, mode, {
          searchedQueries: [spec.imdbId],
          upstreamRequests,
          stale: usedStale
        });
      }

      const candidate = buildInternalScoringCandidate(meta, mediaType);
      const outcome = rankCandidates(spec, [candidate], mediaType);
      const finalized = finalizePublicResults(outcome, mediaType, limit);

      return {
        results: finalized.results,
        resolution: {
          query: spec.rawQuery,
          normalizedQuery: spec.normalizedQuery,
          mediaType,
          mode,
          directImdbLookup: true,
          yearHint: null,
          aliasUsed: null,
          searchedQueries: [spec.imdbId],
          confidence: finalized.confidence,
          exactMatch: finalized.exactMatch,
          ambiguous: finalized.ambiguous,
          ambiguityReason: finalized.ambiguityReason,
          selectedCandidateId: finalized.selectedCandidateId,
          needsFallback: false,
          hydratedCount: 1,
          duplicateIdConflicts: finalized.duplicateIdConflicts,
          cache: {
            hit: false,
            stale: usedStale,
            upstreamRequests
          }
        }
      };
    } catch (error) {
      if (error?.statusCode === 404) {
        return buildEmptyResolution(spec, mediaType, mode, {
          searchedQueries: [spec.imdbId],
          upstreamRequests: upstreamRequests + 1,
          stale: usedStale
        });
      }
      throw error;
    }
  }

  // 2. Catalog search across prioritized deterministic query variants (short-circuiting early)
  const maxVariants = mode === "autocomplete"
    ? CINEMETA_CACHE_CONFIG.variants.autocompleteMax
    : CINEMETA_CACHE_CONFIG.variants.fullModeMax;
  const variants = spec.searchQueries.slice(0, maxVariants);

  const accumulated = [];
  const attemptedQueries = [];
  let lastError = null;
  let successfulFetches = 0;
  let outcome = rankCandidates(spec, [], mediaType);

  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i];
    attemptedQueries.push(variant.query);
    try {
      const { items, stale, upstreamFetched } = await fetchCatalogVariant(variant.query, mediaType, now);
      successfulFetches += 1;
      if (upstreamFetched) upstreamRequests += 1;
      if (stale) usedStale = true;

      accumulated.push(...items);
      outcome = rankCandidates(spec, accumulated, mediaType);

      // Stop querying extra variants as soon as we have a clear high-confidence match
      // or a strong ambiguous remake/franchise set on the primary variant.
      if (outcome.confidence === "high" && !outcome.ambiguous) break;
      if (i === 0 && outcome.ambiguous && outcome.topScore >= 0.78) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (successfulFetches === 0 && lastError) {
    throw lastError;
  }

  // 3. Bounded concurrency metadata hydration (full mode only; autocomplete performs 0 hydration)
  let hydratedCount = 0;
  if (mode === "full" && outcome.ranked.length > 0) {
    const maxHydrate = CINEMETA_CACHE_CONFIG.hydration.fullModeMaxCandidates;
    const seenHydrateIds = new Set();
    const hydrateIndices = [];

    for (let idx = 0; idx < outcome.ranked.length && hydrateIndices.length < maxHydrate; idx += 1) {
      const id = outcome.ranked[idx].candidate.imdbId;
      if (!seenHydrateIds.has(id)) {
        seenHydrateIds.add(id);
        hydrateIndices.push(idx);
      }
    }

    const hydratedOutputs = await mapWithConcurrency(
      hydrateIndices,
      CINEMETA_CACHE_CONFIG.hydration.concurrency,
      idx => hydrateCandidate(outcome.ranked[idx].candidate, mediaType, now)
    );

    const updatedCandidates = outcome.ranked.map(entry => entry.candidate);
    for (let i = 0; i < hydrateIndices.length; i += 1) {
      const targetIdx = hydrateIndices[i];
      const result = hydratedOutputs[i];
      updatedCandidates[targetIdx] = result.candidate;
      if (result.hydrated) hydratedCount += 1;
      if (result.stale) usedStale = true;
      if (result.upstreamFetched) upstreamRequests += 1;
    }

    // Re-rank after hydration so newly populated year/rating/title metadata refines ranking.
    outcome = rankCandidates(spec, updatedCandidates, mediaType);
  }

  const effectiveLimit = limit ?? (mode === "autocomplete" ? CINEMETA_CACHE_CONFIG.autocompleteLimit : null);
  const finalized = finalizePublicResults(outcome, mediaType, effectiveLimit);

  return {
    results: finalized.results,
    resolution: {
      query: spec.rawQuery,
      normalizedQuery: spec.normalizedQuery,
      mediaType,
      mode,
      directImdbLookup: false,
      yearHint: spec.yearHint,
      aliasUsed: spec.aliasMatch ? { id: spec.aliasMatch.id, canonicalTitle: spec.aliasMatch.canonicalTitle } : null,
      searchedQueries: attemptedQueries,
      confidence: finalized.confidence,
      exactMatch: finalized.exactMatch,
      ambiguous: finalized.ambiguous,
      ambiguityReason: finalized.ambiguityReason,
      selectedCandidateId: finalized.selectedCandidateId,
      needsFallback: finalized.needsFallback,
      hydratedCount,
      duplicateIdConflicts: finalized.duplicateIdConflicts,
      cache: {
        hit: false,
        stale: usedStale,
        upstreamRequests
      }
    }
  };
}

export async function searchCinemetaWithResolution(query, mediaType = "series", options = {}) {
  if (!VALID_MEDIA_TYPES.has(mediaType)) {
    throw new Error("Invalid Cinemeta media type");
  }

  const mode = options.mode === undefined ? "full" : options.mode;
  if (!VALID_SEARCH_MODES.has(mode)) {
    const error = new Error("Invalid Cinemeta search mode");
    error.statusCode = 400;
    throw error;
  }

  const now = typeof options.now === "number" ? options.now : Date.now();
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const cleanQuery = String(query || "").trim();
  const spec = parseSearchQuery(cleanQuery, mediaType);

  if (cleanQuery.length < 2) {
    return buildEmptyResolution(spec, mediaType, mode);
  }

  if (!spec.isDirectImdbLookup && !spec.plausible) {
    return buildEmptyResolution(spec, mediaType, mode);
  }

  const cacheKey = `${mediaType}:${mode}:${limit || "all"}:${cleanQuery.toLowerCase()}`;
  const fresh = searchResultCache.getFresh(cacheKey, now);
  if (fresh) {
    cacheStats.searchHits += 1;
    const cloned = cloneSearchPayload(fresh.value);
    cloned.resolution.cache = { hit: true, stale: false, upstreamRequests: 0 };
    return cloned;
  }

  if (inFlightSearch.has(cacheKey)) {
    cacheStats.searchCoalesced += 1;
    const shared = await inFlightSearch.get(cacheKey);
    const cloned = cloneSearchPayload(shared);
    cloned.resolution.cache = { ...cloned.resolution.cache, coalesced: true };
    return cloned;
  }

  cacheStats.searchMisses += 1;
  const promise = (async () => {
    try {
      const payload = await executeResolvedSearch(spec, mediaType, mode, { limit, now });
      if (!payload.resolution.cache.stale) {
        searchResultCache.set(cacheKey, payload, now);
      }
      return payload;
    } catch (error) {
      const stale = searchResultCache.getStale(cacheKey, now);
      if (stale) {
        cacheStats.searchStaleHits += 1;
        const cloned = cloneSearchPayload(stale.value);
        cloned.resolution.cache = { hit: true, stale: true, upstreamRequests: 0 };
        return cloned;
      }
      throw error;
    }
  })();

  inFlightSearch.set(cacheKey, promise);
  try {
    const payload = await promise;
    return cloneSearchPayload(payload);
  } finally {
    inFlightSearch.delete(cacheKey);
  }
}

export async function searchSeries(query, options = {}) {
  const { results } = await searchCinemetaWithResolution(query, "series", options);
  return results;
}

export async function searchMovies(query, options = {}) {
  const { results } = await searchCinemetaWithResolution(query, "movie", options);
  return results;
}

export async function searchCinemeta(query, mediaType = "series", options = {}) {
  const { results } = await searchCinemetaWithResolution(query, mediaType, options);
  return results;
}

function normalizeEpisodes(meta = {}) {
  const videos = Array.isArray(meta.videos) ? meta.videos : [];
  const episodes = {};

  for (const video of videos) {
    const season = Number(video.season);
    const episode = Number(video.episode);
    if (!Number.isInteger(season) || !Number.isInteger(episode)) continue;

    if (!episodes[season]) episodes[season] = [];
    episodes[season].push({
      number: episode,
      title: video.title || `Episode ${episode}`,
      released: video.released || null,
      overview: video.overview || ""
    });
  }

  for (const season of Object.keys(episodes)) episodes[season].sort((a, b) => a.number - b.number);
  return episodes;
}

export async function getSeries(id) {
  if (!isValidImdbId(id)) {
    const error = new Error("Invalid series IMDb ID");
    error.statusCode = 400;
    throw error;
  }
  const { meta } = await fetchRawMeta(id, "series");
  if (!meta) {
    const error = new Error("Series not found");
    error.statusCode = 404;
    throw error;
  }

  return {
    series: normalizeSeries(meta),
    episodes: normalizeEpisodes(meta)
  };
}

export async function getMovie(id) {
  if (!isValidImdbId(id)) {
    const error = new Error("Invalid movie IMDb ID");
    error.statusCode = 400;
    throw error;
  }
  const { meta } = await fetchRawMeta(id, "movie");
  if (!meta) {
    const error = new Error("Movie not found");
    error.statusCode = 404;
    throw error;
  }
  return { movie: normalizeMovie(meta) };
}
