const VALID_MEDIA_TYPES = new Set(['movie', 'series']);
const VALID_CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low', 'none']);

export const AUTOCOMPLETE_CACHE_TTL_MS = 60_000;
export const AUTOCOMPLETE_CACHE_MAX_ENTRIES = 20;

export function normalizeMediaType(mediaType) {
  return mediaType === 'movie' ? 'movie' : 'series';
}

// Preserves the user's actual title text and meaningful punctuation while trimming outer whitespace.
export function normalizeSearchQueryText(rawQuery) {
  return String(rawQuery ?? '').trim();
}

// Normalized key for client-side caching and autocomplete reuse (case- and whitespace-insensitive, media-type-scoped).
export function buildSearchCacheKey(rawQuery, mediaType = 'series') {
  const mt = normalizeMediaType(mediaType);
  const collapsed = normalizeSearchQueryText(rawQuery).replace(/\s+/g, ' ').toLowerCase();
  return `${mt}:${collapsed}`;
}

export function getMediaTypeFallbackLabel(item, activeSearchMode = 'series') {
  const mediaType = VALID_MEDIA_TYPES.has(item?.mediaType)
    ? item.mediaType
    : normalizeMediaType(activeSearchMode);
  return mediaType === 'movie' ? 'Movie' : 'Series';
}

export function normalizeSearchResolution(resolution) {
  if (!resolution || typeof resolution !== 'object') return null;

  return {
    query: typeof resolution.query === 'string' ? resolution.query : '',
    normalizedQuery: typeof resolution.normalizedQuery === 'string' ? resolution.normalizedQuery : '',
    mediaType: normalizeMediaType(resolution.mediaType),
    mode: resolution.mode === 'autocomplete' ? 'autocomplete' : 'full',
    directImdbLookup: Boolean(resolution.directImdbLookup),
    yearHint: Number.isInteger(resolution.yearHint) ? resolution.yearHint : null,
    aliasUsed: resolution.aliasUsed && typeof resolution.aliasUsed === 'object'
      ? {
          id: typeof resolution.aliasUsed.id === 'string' ? resolution.aliasUsed.id : '',
          canonicalTitle: typeof resolution.aliasUsed.canonicalTitle === 'string' ? resolution.aliasUsed.canonicalTitle : ''
        }
      : null,
    searchedQueries: Array.isArray(resolution.searchedQueries)
      ? resolution.searchedQueries.filter(item => typeof item === 'string')
      : [],
    confidence: VALID_CONFIDENCE_LEVELS.has(resolution.confidence) ? resolution.confidence : 'none',
    exactMatch: Boolean(resolution.exactMatch),
    ambiguous: Boolean(resolution.ambiguous),
    ambiguityReason: typeof resolution.ambiguityReason === 'string' ? resolution.ambiguityReason : '',
    selectedCandidateId: typeof resolution.selectedCandidateId === 'string' ? resolution.selectedCandidateId : null,
    needsFallback: Boolean(resolution.needsFallback),
    hydratedCount: Number.isInteger(resolution.hydratedCount) ? resolution.hydratedCount : 0,
    duplicateIdConflicts: Array.isArray(resolution.duplicateIdConflicts) ? resolution.duplicateIdConflicts : []
  };
}

export function filterResultsByMediaType(results, mediaType = 'series') {
  const mt = normalizeMediaType(mediaType);
  if (!Array.isArray(results)) return [];
  return results.filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (mt === 'movie') return item.mediaType === 'movie';
    return item.mediaType !== 'movie';
  });
}

export function canReuseAutocompleteEntry(entry, rawQuery, mediaType, now = Date.now(), ttlMs = AUTOCOMPLETE_CACHE_TTL_MS) {
  if (!entry || typeof entry !== 'object') return false;
  const mt = normalizeMediaType(mediaType);
  if (entry.mediaType !== mt) return false;
  if (entry.key !== buildSearchCacheKey(rawQuery, mt)) return false;
  if (typeof entry.storedAt !== 'number' || now - entry.storedAt > ttlMs) return false;
  if (!Array.isArray(entry.results) || entry.results.length === 0) return false;

  const res = entry.resolution;
  if (res) {
    // Do not reuse responses that need fallback or had low/no confidence.
    if (res.needsFallback || res.confidence === 'low' || res.confidence === 'none') {
      return false;
    }
    // If the user specified a release year and autocomplete catalog items lack years,
    // let full search run so metadata hydration can disambiguate remakes accurately.
    if (res.yearHint !== null && entry.results.some(item => !item?.year)) {
      return false;
    }
  }

  return true;
}

export function createAutocompleteCache({ ttlMs = AUTOCOMPLETE_CACHE_TTL_MS, maxEntries = AUTOCOMPLETE_CACHE_MAX_ENTRIES } = {}) {
  const entries = new Map();

  function set(rawQuery, mediaType, payload, now = Date.now()) {
    const mt = normalizeMediaType(mediaType);
    const cleanQuery = normalizeSearchQueryText(rawQuery);
    if (cleanQuery.length < 2) return null;
    const key = buildSearchCacheKey(cleanQuery, mt);
    const results = filterResultsByMediaType(payload?.results, mt);
    const resolution = normalizeSearchResolution(payload?.resolution);

    const record = {
      key,
      query: cleanQuery,
      mediaType: mt,
      results,
      resolution,
      storedAt: now
    };

    if (entries.has(key)) entries.delete(key);
    entries.set(key, record);
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
    return record;
  }

  function getReusable(rawQuery, mediaType, now = Date.now()) {
    const mt = normalizeMediaType(mediaType);
    const key = buildSearchCacheKey(rawQuery, mt);
    const entry = entries.get(key);
    if (!entry) return null;
    if (now - entry.storedAt > ttlMs) {
      entries.delete(key);
      return null;
    }
    if (!canReuseAutocompleteEntry(entry, rawQuery, mt, now, ttlMs)) return null;
    return {
      ...entry,
      results: [...entry.results]
    };
  }

  function clear() {
    entries.clear();
  }

  return {
    set,
    getReusable,
    clear,
    get size() {
      return entries.size;
    }
  };
}

// Determines how "Change movie" / "Change series" restores discovery without hardcoded demo resets.
export function resolveChangeSelectionAction({ selectedMediaType, query, lastSearch }) {
  const mediaType = normalizeMediaType(selectedMediaType);
  const cleanQuery = normalizeSearchQueryText(query);

  if (
    lastSearch
    && lastSearch.mediaType === mediaType
    && Array.isArray(lastSearch.results)
    && lastSearch.results.length > 0
    && (!cleanQuery || lastSearch.key === buildSearchCacheKey(cleanQuery, mediaType))
  ) {
    return {
      action: 'restore-results',
      mediaType,
      results: [...lastSearch.results],
      resolution: lastSearch.resolution || null
    };
  }

  if (cleanQuery.length >= 2) {
    return {
      action: 'run-search',
      mediaType,
      query: cleanQuery
    };
  }

  return {
    action: 'return-empty',
    mediaType
  };
}
