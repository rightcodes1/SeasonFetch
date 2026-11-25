import {
  getKnownAliasesForCandidate,
  isAliasTitleConsistent,
  lookupTitleAliases,
  normalizeAliasKey
} from "./titleAliases.js";

const VALID_MEDIA_TYPES = new Set(["movie", "series"]);
const MIN_YEAR = 1900;
const MAX_YEAR = 2035;

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "in", "on", "to", "for", "and", "or",
  "at", "by", "with", "is", "it", "from", "as", "into"
]);

// Multi-character Roman numerals only; never convert single letters like "v", "x", or "i"
// which frequently appear in titles ("V", "X-Files", "Hunter x Hunter", "I, Robot").
const ROMAN_TO_ARABIC = new Map([
  ["ii", "2"],
  ["iii", "3"],
  ["iv", "4"],
  ["vi", "6"],
  ["vii", "7"],
  ["viii", "8"],
  ["ix", "9"]
]);

const ARABIC_TO_ROMAN = new Map(
  [...ROMAN_TO_ARABIC.entries()].map(([roman, arabic]) => [arabic, roman])
);

const INSTALLMENT_PRECEDING_WORDS = new Set([
  "part", "chapter", "vol", "volume", "book", "act", "episode", "ep", "phase"
]);

// Strictly trailing watch-intent / release-qualifier patterns.
// Anchored to the end of the query so title internals (e.g., "Star Wars: Episode 4",
// "Season of the Witch") are never corrupted.
const TRAILING_NOISE_PATTERNS = [
  { label: "season-episode", regex: /\s+(?:s\d{1,2}\s*e\d{1,3})\s*$/i },
  { label: "season-episode", regex: /\s+(?:season|series)\s*0?\d{1,2}\s+(?:episode|ep)\s*0?\d{1,3}\s*$/i },
  { label: "season", regex: /\s+(?:season|series)\s*0?\d{1,2}\s*$/i },
  { label: "short-season", regex: /\s+(?:s0?\d{1,2})\s*$/i },
  { label: "resolution", regex: /\s+(?:2160p|1440p|1080p|720p|576p|480p|4k|uhd)\s*$/i },
  { label: "release-tag", regex: /\s+(?:web-?dl|webrip|bluray|blu-?ray|hdr10|dolby\s+vision|x264|x265|hevc|av1|h\.?264|h\.?265)\s*$/i },
  { label: "audio-tag", regex: /\s+(?:english\s+dub(?:bed)?|eng\s+dub|dual\s+audio|dubbed|subbed)\s*$/i },
  { label: "format-tag", regex: /\s+(?:full\s+movie|complete\s+series|all\s+seasons)\s*$/i }
];

const DIRECT_IMDB_REGEX = /^\s*(?:https?:\/\/(?:www\.|m\.)?imdb\.com\/title\/)?(tt\d{6,10})(?:\/.*)?\s*$/i;
const NON_LATIN_SCRIPT_REGEX = /[^\u0000-\u024F\s\p{P}\p{S}]/u;

export function normalizeMediaType(mediaType = "series") {
  const clean = String(mediaType || "series").trim().toLowerCase();
  return VALID_MEDIA_TYPES.has(clean) ? clean : "series";
}

export function normalizeTitleText(text) {
  return normalizeAliasKey(text);
}

export function tokenizeTitle(normalizedText) {
  const clean = normalizeTitleText(normalizedText);
  return clean ? clean.split(" ").filter(Boolean) : [];
}

function isExplicitInstallmentPosition(tokens, index) {
  if (!Array.isArray(tokens) || tokens.length < 2 || index <= 0) return false;
  return INSTALLMENT_PRECEDING_WORDS.has(tokens[index - 1]);
}

function isRomanInstallmentPosition(tokens, index) {
  if (!Array.isArray(tokens) || tokens.length < 2 || index <= 0) return false;
  const prev = tokens[index - 1];
  if (INSTALLMENT_PRECEDING_WORDS.has(prev)) return true;
  // Trailing sequel numeral on a multi-word title (e.g., "rocky iv", "godfather ii"),
  // guarded so short/numeric prefixes like "a iv" or "2 ii" are not converted.
  if (index === tokens.length - 1 && prev.length >= 3 && !/^\d+$/.test(prev) && !STOP_WORDS.has(prev)) {
    return true;
  }
  return false;
}

function isArabicToRomanQueryPosition(tokens, index) {
  // Only generate Roman-numeral search variants immediately after explicit installment markers
  // (e.g., "dune part 2" -> "dune part ii", "star wars episode 4" -> "star wars episode iv").
  // Never turn ordinary numeric titles ("2 Fast 2 Furious", "District 9") into Roman numerals.
  return isExplicitInstallmentPosition(tokens, index);
}

export function normalizeExplicitInstallmentNumerals(normalizedText) {
  const tokens = tokenizeTitle(normalizedText);
  return tokens
    .map((token, index) => (
      isExplicitInstallmentPosition(tokens, index) && ROMAN_TO_ARABIC.has(token)
        ? ROMAN_TO_ARABIC.get(token)
        : token
    ))
    .join(" ");
}

export function normalizeNumerals(normalizedText) {
  const tokens = tokenizeTitle(normalizedText);
  return tokens
    .map((token, index) => (
      isRomanInstallmentPosition(tokens, index) && ROMAN_TO_ARABIC.has(token)
        ? ROMAN_TO_ARABIC.get(token)
        : token
    ))
    .join(" ");
}

function stripLeadingArticle(normalizedText) {
  return String(normalizedText || "").replace(/^(?:the|a|an)\s+/, "").trim();
}

function isPlaceholderTitle(title) {
  const trimmed = String(title || "").trim();
  return !trimmed || /^unknown title$/i.test(trimmed);
}

function isGenericDisplayType(typeValue) {
  const trimmed = String(typeValue || "").trim();
  return !trimmed || /^(?:series|movie)$/i.test(trimmed);
}

export function parseCandidateYear(yearValue) {
  if (Number.isInteger(yearValue) && yearValue >= MIN_YEAR && yearValue <= MAX_YEAR) {
    return yearValue;
  }
  const match = String(yearValue || "").match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return parsed >= MIN_YEAR && parsed <= MAX_YEAR ? parsed : null;
}

function extractYearHint(text) {
  const raw = String(text || "").trim();
  if (!raw) return { textWithoutYear: "", yearHint: null, yearHintSource: null };

  // 1. Explicit parenthesized or bracketed year (e.g., "Dune (2021)", "The Office [2005]")
  const wrappedMatch = raw.match(/(?:\(|\[)\s*(19\d{2}|20\d{2})\s*(?:\)|\])/);
  if (wrappedMatch) {
    const year = Number(wrappedMatch[1]);
    const remainder = raw.replace(wrappedMatch[0], " ").replace(/\s+/g, " ").trim();
    if (year >= MIN_YEAR && year <= MAX_YEAR && normalizeTitleText(remainder).length >= 2) {
      return { textWithoutYear: remainder, yearHint: year, yearHintSource: "explicit" };
    }
  }

  // 2. Bare trailing 4-digit year (e.g., "Dune 2021", "Wonder Woman 1984", "Space: 1999").
  //    Marked as yearHintSource="trailing" so scoring preserves the full title form first
  //    for titles whose name legitimately ends with a year.
  const trailingMatch = raw.match(/^(.*?)(?:[\s:]+)(19\d{2}|20\d{2})\s*$/);
  if (trailingMatch) {
    const candidatePrefix = trailingMatch[1].trim();
    const year = Number(trailingMatch[2]);
    const normalizedPrefix = normalizeTitleText(candidatePrefix);
    if (year >= MIN_YEAR && year <= MAX_YEAR && normalizedPrefix.length >= 2) {
      return { textWithoutYear: candidatePrefix, yearHint: year, yearHintSource: "trailing" };
    }
  }

  return { textWithoutYear: raw, yearHint: null, yearHintSource: null };
}

function stripQueryNoise(text) {
  let working = String(text || "").trim();
  const strippedNoise = [];

  // Iteratively strip unambiguous trailing watch-intent qualifiers only.
  let changed = true;
  while (changed) {
    changed = false;
    for (const { label, regex } of TRAILING_NOISE_PATTERNS) {
      const candidate = working.replace(regex, "").trim();
      if (candidate !== working && normalizeTitleText(candidate).length >= 2) {
        if (!strippedNoise.includes(label)) strippedNoise.push(label);
        working = candidate;
        changed = true;
      }
    }
  }

  return { cleanedText: working, strippedNoise };
}

function buildQueryVariants({
  normalizedQuery,
  rawNormalizedQuery,
  fullNormalizedQuery,
  yearHintSource,
  strippedNoise,
  aliasMatch,
  tokens
}) {
  const variants = [];
  const seen = new Set();

  function add(query, reason) {
    const trimmed = String(query || "").trim();
    const key = normalizeTitleText(trimmed);
    if (!key || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    variants.push({ query: trimmed, normalized: key, reason });
  }

  // Primary query: unambiguous alias canonical title first, otherwise normalized cleaned title
  // (putting "dune" ahead of "dune 2021" avoids wasted primary catalog misses on Cinemeta
  // while retaining "wonder woman 1984" as an immediate secondary variant).
  if (aliasMatch) {
    add(aliasMatch.canonicalTitle, `alias:${aliasMatch.id}`);
  }
  add(normalizedQuery, "normalized");

  if (yearHintSource === "trailing" && fullNormalizedQuery && fullNormalizedQuery !== normalizedQuery) {
    add(fullNormalizedQuery, "full-title-with-year");
  }

  // When a single trailing qualifier was stripped (e.g. "Life in 4K"), preserve the literal unstripped
  // form as a secondary variant so real titles ending in "4K" or similar words remain searchable.
  if (strippedNoise.length === 1 && rawNormalizedQuery && rawNormalizedQuery !== normalizedQuery && variants.length < 3) {
    add(rawNormalizedQuery, "raw-unstripped");
  }

  // Contextual Roman <-> Arabic sequel variants only (never ordinary numbers like "District 9").
  const arabicVersion = normalizeNumerals(normalizedQuery);
  if (arabicVersion !== normalizedQuery && variants.length < 3) {
    add(arabicVersion, "numeral-arabic");
  }

  const romanVersion = tokens
    .map((token, index) => (
      isArabicToRomanQueryPosition(tokens, index) && ARABIC_TO_ROMAN.has(token)
        ? ARABIC_TO_ROMAN.get(token)
        : token
    ))
    .join(" ");
  if (romanVersion !== normalizedQuery && variants.length < 3) {
    add(romanVersion, "numeral-roman");
  }

  // Leading article stripped for multi-word queries ("the bear" -> "bear" only if remaining >= 4 chars).
  const withoutArticle = stripLeadingArticle(normalizedQuery);
  if (withoutArticle !== normalizedQuery && withoutArticle.length >= 4 && variants.length < 3) {
    add(withoutArticle, "article-stripped");
  }

  // Alias colon prefix fallback ("Frieren: Beyond Journey's End" -> "Frieren").
  if (aliasMatch && aliasMatch.canonicalTitle.includes(":") && variants.length < 3) {
    const prefix = aliasMatch.canonicalTitle.split(":")[0].trim();
    if (normalizeTitleText(prefix).length >= 4) {
      add(prefix, "alias-prefix");
    }
  }

  return variants.slice(0, 3);
}

export function isPlausibleSearchQuery(queryOrSpec) {
  const spec = typeof queryOrSpec === "string"
    ? parseSearchQuery(queryOrSpec)
    : queryOrSpec;

  if (!spec) return false;
  if (spec.isDirectImdbLookup) return true;
  if (spec.nonLatinScript && !spec.normalizedQuery) return false;

  const norm = spec.normalizedQuery || "";
  if (norm.length < 2 || norm.length > 140) return false;

  const compact = norm.replace(/\s+/g, "");
  if (compact.length < 2) return false;

  // Reject single-character repetition (e.g. "aaaaaa", "zzzzz")
  if (compact.length >= 4 && /^(.)\1+$/.test(compact)) return false;

  // Reject pure keyboard-smash gibberish (long consonant-only ASCII strings without spaces or digits)
  if (
    spec.tokens.length === 1
    && compact.length >= 7
    && /^[a-z]+$/.test(compact)
    && !/[aeiouy]/.test(compact)
  ) {
    return false;
  }

  return true;
}

export function parseSearchQuery(rawQuery = "", mediaType = "series") {
  const normalizedMediaType = normalizeMediaType(mediaType);
  const original = String(rawQuery || "").trim();
  const nonLatinScript = NON_LATIN_SCRIPT_REGEX.test(original);

  // Direct IMDb ID or IMDb URL shortcut
  const imdbMatch = original.match(DIRECT_IMDB_REGEX);
  if (imdbMatch) {
    const imdbId = imdbMatch[1].toLowerCase();
    return {
      rawQuery: original,
      mediaType: normalizedMediaType,
      imdbId,
      isDirectImdbLookup: true,
      nonLatinScript: false,
      yearHint: null,
      yearHintSource: null,
      strippedNoise: [],
      cleanedText: imdbId,
      rawNormalizedQuery: imdbId,
      fullNormalizedQuery: imdbId,
      fullNumeralNormalizedQuery: imdbId,
      fullExplicitNumeralNormalizedQuery: imdbId,
      normalizedQuery: imdbId,
      numeralNormalizedQuery: imdbId,
      explicitNumeralNormalizedQuery: imdbId,
      tokens: [imdbId],
      significantTokens: [imdbId],
      isShortQuery: false,
      aliasMatch: null,
      aliasCandidates: [],
      searchQueries: [{ query: imdbId, normalized: imdbId, reason: "imdb-id" }],
      plausible: true
    };
  }

  const rawNormalizedQuery = normalizeTitleText(original);
  const { cleanedText: noiseStripped, strippedNoise } = stripQueryNoise(original);
  const fullNormalizedQuery = normalizeTitleText(noiseStripped);
  const fullNumeralNormalizedQuery = normalizeNumerals(fullNormalizedQuery);
  const fullExplicitNumeralNormalizedQuery = normalizeExplicitInstallmentNumerals(fullNormalizedQuery);

  const { textWithoutYear, yearHint, yearHintSource } = extractYearHint(noiseStripped);
  const normalizedQuery = normalizeTitleText(textWithoutYear);
  const numeralNormalizedQuery = normalizeNumerals(normalizedQuery);
  const explicitNumeralNormalizedQuery = normalizeExplicitInstallmentNumerals(normalizedQuery);
  const tokens = tokenizeTitle(normalizedQuery);
  const significantTokens = tokens.filter(token => !STOP_WORDS.has(token));

  const isShortQuery = normalizedQuery.length > 0 && (
    normalizedQuery.length <= 4
    || (tokens.length === 1 && tokens[0].length <= 4)
  );

  // Check exact alias match against normalized query (and full title with year if distinct).
  const aliasCandidates = lookupTitleAliases(normalizedQuery, normalizedMediaType);
  const aliasMatch = aliasCandidates.length === 1 ? aliasCandidates[0] : null;

  const searchQueries = buildQueryVariants({
    normalizedQuery,
    rawNormalizedQuery,
    fullNormalizedQuery,
    yearHintSource,
    strippedNoise,
    aliasMatch,
    tokens
  });

  const spec = {
    rawQuery: original,
    mediaType: normalizedMediaType,
    imdbId: null,
    isDirectImdbLookup: false,
    nonLatinScript,
    yearHint,
    yearHintSource,
    strippedNoise,
    cleanedText: textWithoutYear,
    rawNormalizedQuery,
    fullNormalizedQuery,
    fullNumeralNormalizedQuery,
    fullExplicitNumeralNormalizedQuery,
    normalizedQuery,
    numeralNormalizedQuery,
    explicitNumeralNormalizedQuery,
    tokens,
    significantTokens,
    isShortQuery,
    aliasMatch,
    aliasCandidates,
    searchQueries,
    plausible: false
  };

  spec.plausible = isPlausibleSearchQuery(spec);
  return spec;
}

// Optimal String Alignment (Damerau-Levenshtein) distance with optional early-exit max cap.
export function damerauLevenshtein(a, b, maxDistance = Infinity) {
  const s = String(a || "");
  const t = String(b || "");
  const m = s.length;
  const n = t.length;

  if (s === t) return 0;
  if (Math.abs(m - n) > maxDistance) return maxDistance + 1;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
  }

  return dp[m][n];
}

function normalizedSimilarity(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  const maxLen = Math.max(s.length, t.length);
  if (maxLen === 0) return { distance: 0, similarity: 0 };
  const distance = damerauLevenshtein(s, t);
  return { distance, similarity: Math.max(0, 1 - distance / maxLen) };
}

function maxAllowedTokenEditDistance(queryToken, candToken) {
  const minLen = Math.min(queryToken.length, candToken.length);
  // Short tokens (<= 4 chars) require exact match so "dark"/"park", "lost"/"last", "you"/"your" never cross-match.
  if (minLen <= 4) return 0;
  if (minLen <= 6) return 1;
  return 2;
}

function tokensEqualWithContextualNumerals(qTokens, qIndex, cTokens, cIndex) {
  const qTok = qTokens[qIndex];
  const cTok = cTokens[cIndex];
  if (qTok === cTok) return true;

  const qNormalized = isRomanInstallmentPosition(qTokens, qIndex) && ROMAN_TO_ARABIC.has(qTok)
    ? ROMAN_TO_ARABIC.get(qTok)
    : qTok;
  const cNormalized = isRomanInstallmentPosition(cTokens, cIndex) && ROMAN_TO_ARABIC.has(cTok)
    ? ROMAN_TO_ARABIC.get(cTok)
    : cTok;

  // Require both tokens to be in an installment context before equating Roman <-> Arabic.
  const qIsInstallment = isRomanInstallmentPosition(qTokens, qIndex) || isArabicToRomanQueryPosition(qTokens, qIndex);
  const cIsInstallment = isRomanInstallmentPosition(cTokens, cIndex) || isArabicToRomanQueryPosition(cTokens, cIndex);
  return qIsInstallment && cIsInstallment && qNormalized === cNormalized;
}

function evaluateTokenAlignment(queryTokens, candTokens) {
  if (!queryTokens.length || !candTokens.length) {
    return {
      exactHits: 0,
      typoHits: 0,
      significantExactHits: 0,
      significantTypoHits: 0,
      orderedCoverage: 0,
      jaccard: 0,
      stopwordOnly: false
    };
  }

  const usedCand = new Set();
  let exactHits = 0;
  let typoHits = 0;
  let significantExactHits = 0;
  let significantTypoHits = 0;
  let lastMatchedCandIdx = -1;
  let orderedHits = 0;

  for (let qIdx = 0; qIdx < queryTokens.length; qIdx++) {
    const qTok = queryTokens[qIdx];
    const isSig = !STOP_WORDS.has(qTok);
    // 1. Exact token match first (preferring in-order index)
    let bestIdx = -1;
    for (let i = 0; i < candTokens.length; i++) {
      if (usedCand.has(i)) continue;
      if (tokensEqualWithContextualNumerals(queryTokens, qIdx, candTokens, i)) {
        bestIdx = i;
        if (i > lastMatchedCandIdx) break;
      }
    }

    if (bestIdx !== -1) {
      usedCand.add(bestIdx);
      exactHits += 1;
      if (isSig) significantExactHits += 1;
      if (bestIdx > lastMatchedCandIdx) {
        orderedHits += 1;
        lastMatchedCandIdx = bestIdx;
      }
      continue;
    }

    // 2. Bounded per-token typo match (only for non-short tokens, length >= 5)
    let bestTypoIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < candTokens.length; i++) {
      if (usedCand.has(i)) continue;
      const cTok = candTokens[i];
      const maxDist = maxAllowedTokenEditDistance(qTok, cTok);
      if (maxDist === 0) continue;
      const dist = damerauLevenshtein(qTok, cTok, maxDist);
      if (dist <= maxDist && dist < bestDist) {
        bestDist = dist;
        bestTypoIdx = i;
      }
    }

    if (bestTypoIdx !== -1) {
      usedCand.add(bestTypoIdx);
      typoHits += 1;
      if (isSig) significantTypoHits += 1;
      if (bestTypoIdx > lastMatchedCandIdx) {
        orderedHits += 0.85;
        lastMatchedCandIdx = bestTypoIdx;
      }
    }
  }

  const weightedMatches = exactHits + typoHits * 0.82;
  const unionSize = queryTokens.length + candTokens.length - (exactHits + typoHits);
  const jaccard = unionSize > 0 ? weightedMatches / unionSize : 0;
  const orderedCoverage = queryTokens.length > 0 ? orderedHits / queryTokens.length : 0;
  const totalMatches = exactHits + typoHits;
  const stopwordOnly = totalMatches > 0 && (significantExactHits + significantTypoHits) === 0;

  return {
    exactHits,
    typoHits,
    significantExactHits,
    significantTypoHits,
    orderedCoverage,
    jaccard,
    stopwordOnly
  };
}

function extractCandidateAlternateTitles(candidate) {
  const verified = [];
  const unverified = [];
  const pushTo = (list, value) => {
    if (typeof value === "string" && value.trim()) list.push(value.trim());
  };

  // Only explicitly verified alternate titles may qualify for high-confidence automatic selection.
  if (Array.isArray(candidate?.verifiedAlternateTitles)) {
    for (const item of candidate.verifiedAlternateTitles) pushTo(verified, item);
  }

  // Upstream metadata fields (Cinemeta, aggregators, etc.) are treated as unverified hints.
  for (const field of ["originalTitle", "originalName"]) {
    pushTo(unverified, candidate?.[field]);
  }
  for (const listField of ["aliases", "alternateTitles", "aka"]) {
    if (Array.isArray(candidate?.[listField])) {
      for (const item of candidate[listField]) pushTo(unverified, item);
    }
  }

  return {
    verified: [...new Set(verified)],
    unverified: [...new Set(unverified)]
  };
}

function getCandidateMediaType(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const hasExplicitMediaType = Object.hasOwn(candidate, "mediaType")
    && candidate.mediaType !== undefined
    && candidate.mediaType !== null;
  if (hasExplicitMediaType) {
    return VALID_MEDIA_TYPES.has(candidate.mediaType) ? candidate.mediaType : null;
  }
  if (VALID_MEDIA_TYPES.has(candidate.type)) return candidate.type;
  return null;
}

function computeMetadataCompleteness(candidate) {
  let score = 0;
  const signals = [];
  if (candidate?.poster) {
    score += 0.01;
    signals.push("poster");
  }
  if (parseCandidateYear(candidate?.year) !== null) {
    score += 0.01;
    signals.push("year");
  }
  const numericRating = Number(candidate?.rating ?? candidate?.imdbRating);
  if (Number.isFinite(numericRating) && numericRating > 0 && numericRating <= 10) {
    score += 0.01 + Math.min(0.01, (numericRating / 10) * 0.01);
    signals.push("rating");
  }
  return { bonus: Math.min(0.04, Number(score.toFixed(4))), signals };
}

function roundScore(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function titlesCompatibleForMerge(titleA, titleB) {
  if (isPlaceholderTitle(titleA) || isPlaceholderTitle(titleB)) return true;
  const normA = normalizeTitleText(titleA);
  const normB = normalizeTitleText(titleB);
  if (!normA || !normB) return true;
  if (normA === normB) return true;
  if (stripLeadingArticle(normA) === stripLeadingArticle(normB)) return true;
  if (normalizeNumerals(normA) === normalizeNumerals(normB)) return true;
  if (normA.startsWith(`${normB} `) || normB.startsWith(`${normA} `)) return true;
  return false;
}

function canSafelyMergeCandidates(existing, incoming) {
  const existingTitle = existing.title || existing.name || "";
  const incomingTitle = incoming.title || incoming.name || "";
  if (!titlesCompatibleForMerge(existingTitle, incomingTitle)) return false;

  const existingYear = parseCandidateYear(existing.year);
  const incomingYear = parseCandidateYear(incoming.year);
  if (existingYear !== null && incomingYear !== null && Math.abs(existingYear - incomingYear) >= 2) {
    return false;
  }

  return true;
}

function mergeTwoCandidates(existing, incoming, imdbId) {
  const existingTitle = existing.title || existing.name || "";
  const incomingTitle = incoming.title || incoming.name || "";
  const title = !isPlaceholderTitle(existingTitle)
    ? existingTitle
    : !isPlaceholderTitle(incomingTitle)
      ? incomingTitle
      : (existingTitle || incomingTitle || "Unknown title");

  const hasTitleField = Object.hasOwn(existing, "title") || Object.hasOwn(incoming, "title");
  const hasYearField = Object.hasOwn(existing, "year") || Object.hasOwn(incoming, "year");
  const hasRatingField = Object.hasOwn(existing, "rating") || Object.hasOwn(incoming, "rating")
    || Object.hasOwn(existing, "imdbRating") || Object.hasOwn(incoming, "imdbRating");
  const hasPosterField = Object.hasOwn(existing, "poster") || Object.hasOwn(incoming, "poster");
  const hasSynopsisField = Object.hasOwn(existing, "synopsis") || Object.hasOwn(incoming, "synopsis")
    || Object.hasOwn(existing, "description") || Object.hasOwn(incoming, "description");
  const hasGenresField = Object.hasOwn(existing, "genres") || Object.hasOwn(incoming, "genres");
  const hasTypeField = Object.hasOwn(existing, "type") || Object.hasOwn(incoming, "type");
  const hasMediaTypeField = Object.hasOwn(existing, "mediaType") || Object.hasOwn(incoming, "mediaType");

  const merged = { ...existing };

  // Copy non-conflicting extra fields from incoming without leaking raw synonyms onto normalized records.
  const rawSynonymKeys = new Set(["name", "description", "imdbRating"]);
  for (const [key, value] of Object.entries(incoming)) {
    if (rawSynonymKeys.has(key)) continue;
    if (!Object.hasOwn(merged, key) && value !== undefined) {
      merged[key] = value;
    }
  }

  merged.id = existing.id || incoming.id || imdbId;
  merged.imdbId = imdbId;
  merged.title = title;
  if (hasTitleField && Object.hasOwn(merged, "name")) {
    delete merged.name;
  }

  if (hasYearField) {
    const existingYear = parseCandidateYear(existing.year) !== null ? existing.year : null;
    const incomingYear = parseCandidateYear(incoming.year) !== null ? incoming.year : null;
    merged.year = existingYear || incomingYear || existing.year || incoming.year || null;
  }

  if (hasRatingField) {
    const existingRating = existing.rating ?? existing.imdbRating ?? null;
    const incomingRating = incoming.rating ?? incoming.imdbRating ?? null;
    merged.rating = existingRating || incomingRating || null;
    if (Object.hasOwn(merged, "imdbRating")) {
      delete merged.imdbRating;
    }
  }

  if (hasPosterField) {
    merged.poster = existing.poster || incoming.poster || null;
  }

  if (hasSynopsisField) {
    const existingSynopsis = existing.synopsis || existing.description || "";
    const incomingSynopsis = incoming.synopsis || incoming.description || "";
    merged.synopsis = existingSynopsis.length >= incomingSynopsis.length ? existingSynopsis : incomingSynopsis;
    if (Object.hasOwn(merged, "description")) {
      delete merged.description;
    }
  }

  if (hasGenresField) {
    const existingGenres = Array.isArray(existing.genres) ? existing.genres : [];
    const incomingGenres = Array.isArray(incoming.genres) ? incoming.genres : [];
    merged.genres = existingGenres.length >= incomingGenres.length ? existingGenres : incomingGenres;
  }

  if (hasTypeField) {
    merged.type = !isGenericDisplayType(existing.type)
      ? existing.type
      : !isGenericDisplayType(incoming.type)
        ? incoming.type
        : (existing.type || incoming.type);
  }

  if (hasMediaTypeField) {
    const existingMt = VALID_MEDIA_TYPES.has(existing.mediaType) ? existing.mediaType : null;
    const incomingMt = VALID_MEDIA_TYPES.has(incoming.mediaType) ? incoming.mediaType : null;
    merged.mediaType = existingMt || incomingMt || existing.mediaType || incoming.mediaType;
  }

  // Preserve verified and unverified alternate titles separately, only when explicitly present.
  for (const listKey of ["verifiedAlternateTitles", "alternateTitles"]) {
    const hadList = Object.hasOwn(existing, listKey) || Object.hasOwn(incoming, listKey);
    if (hadList) {
      const items = [
        ...(Array.isArray(existing[listKey]) ? existing[listKey] : []),
        ...(Array.isArray(incoming[listKey]) ? incoming[listKey] : [])
      ].filter(v => typeof v === "string" && v.trim());
      if (items.length) merged[listKey] = [...new Set(items)];
    }
  }

  return merged;
}

export function deduplicateCandidates(candidates = [], mediaType = null) {
  const targetMediaType = mediaType ? normalizeMediaType(mediaType) : null;
  const buckets = new Map();
  const results = [];

  for (const raw of Array.isArray(candidates) ? candidates : []) {
    if (!raw || typeof raw !== "object") continue;
    const imdbId = String(raw.imdbId || raw.id || "").trim().toLowerCase();
    if (!/^tt\d+$/.test(imdbId)) continue;

    const candType = getCandidateMediaType(raw);
    if (targetMediaType && candType && candType !== targetMediaType) continue;

    // When no target mediaType is specified, never merge conflicting movie & series records.
    const dedupeKey = targetMediaType ? imdbId : `${candType || "unknown"}:${imdbId}`;

    const indices = buckets.get(dedupeKey) || [];
    let mergedIndex = -1;
    for (const idx of indices) {
      if (canSafelyMergeCandidates(results[idx], raw)) {
        mergedIndex = idx;
        break;
      }
    }

    if (mergedIndex === -1) {
      const nextIdx = results.length;
      results.push({ ...raw, imdbId, id: raw.id || imdbId });
      indices.push(nextIdx);
      buckets.set(dedupeKey, indices);
    } else {
      results[mergedIndex] = mergeTwoCandidates(results[mergedIndex], raw, imdbId);
    }
  }

  return results;
}

export function scoreCandidate(queryOrSpec, candidate, mediaType) {
  const isPreparsedSpec = Boolean(queryOrSpec && typeof queryOrSpec === "object");
  const targetMediaType = normalizeMediaType(
    mediaType !== undefined
      ? mediaType
      : (isPreparsedSpec ? queryOrSpec.mediaType : "series")
  );
  const spec = isPreparsedSpec
    ? queryOrSpec
    : parseSearchQuery(queryOrSpec, targetMediaType);

  const imdbId = String(candidate?.imdbId || candidate?.id || "").trim().toLowerCase();
  const rawTitle = String(candidate?.title || candidate?.name || "").trim();
  const candNorm = normalizeTitleText(rawTitle);
  const candExplicitNumNorm = normalizeExplicitInstallmentNumerals(candNorm);
  const candNumNorm = normalizeNumerals(candNorm);
  const candTokens = tokenizeTitle(candNorm);
  const candSignificantTokens = candTokens.filter(t => !STOP_WORDS.has(t));
  const candYear = parseCandidateYear(candidate?.year);
  const candMediaType = getCandidateMediaType(candidate);
  const mediaTypeStatus = candMediaType === targetMediaType
    ? "match"
    : candMediaType === null
      ? "unknown"
      : "mismatch";
  const mediaTypeVerified = mediaTypeStatus === "match";
  const mediaTypeCompatible = mediaTypeStatus !== "mismatch";

  const reasons = [];
  const evidence = {
    matchType: "none",
    exactTitleMatch: false,
    aliasMatch: false,
    aliasTitleConflict: false,
    alternateTitleMatch: false,
    unverifiedAlternateTitleMatch: false,
    alternateTitleVerified: false,
    imdbIdMatch: false,
    prefixMatch: false,
    franchiseAmbiguous: false,
    yearPartOfTitle: false,
    tokenSimilarity: 0,
    orderedTokenCoverage: 0,
    typoSimilarity: 0,
    editDistance: null,
    yearCompatibility: "not-specified",
    candidateYear: candYear,
    mediaTypeStatus,
    mediaTypeVerified,
    mediaTypeCompatible,
    metadataCompleteness: 0,
    shortTitleGuardApplied: false,
    typoOnlyCapped: false,
    ambiguityDowngraded: false,
    score: 0,
    confidence: "none",
    reasons
  };

  if (mediaTypeStatus === "mismatch") {
    reasons.push(`Media type mismatch: expected ${targetMediaType}, got ${candMediaType}`);
    return evidence;
  }

  // 1. Direct IMDb ID match
  if (spec.isDirectImdbLookup && spec.imdbId) {
    if (imdbId === spec.imdbId) {
      evidence.matchType = "imdb-id";
      evidence.imdbIdMatch = true;
      if (mediaTypeStatus === "unknown") {
        evidence.score = 0.78;
        evidence.confidence = "medium";
        reasons.push(`Direct IMDb ID match (${spec.imdbId}), but candidate missing verified media type; capped below high confidence`);
      } else {
        evidence.score = 1.0;
        evidence.confidence = "high";
        reasons.push(`Direct IMDb ID match (${spec.imdbId})`);
      }
      return evidence;
    }
    reasons.push(`IMDb ID does not match ${spec.imdbId}`);
    return evidence;
  }

  if (!spec.plausible || !spec.normalizedQuery || !candNorm) {
    reasons.push(spec.nonLatinScript ? "Non-Latin script query requires alternate title or fallback" : "Implausible or empty query/candidate");
    return evidence;
  }

  const altGroups = extractCandidateAlternateTitles(candidate);
  const mapAlts = list => list.map(title => {
    const norm = normalizeTitleText(title);
    return {
      raw: title,
      norm,
      explicitNumNorm: normalizeExplicitInstallmentNumerals(norm),
      numNorm: normalizeNumerals(norm)
    };
  });
  const verifiedAlts = mapAlts(altGroups.verified);
  const unverifiedAlts = mapAlts(altGroups.unverified);

  const knownAliasEntries = getKnownAliasesForCandidate(candidate, targetMediaType);

  let baseScore = 0;
  let unverifiedAltHasPrimarySupport = false;

  // 2A. Exact match against full query preserving a trailing year that is genuinely part of the title
  //     (e.g., "Wonder Woman 1984" (2020), "Death Race 2000" (1975), "Space: 1999" (1975)).
  if (
    spec.yearHintSource === "trailing"
    && spec.fullNormalizedQuery
    && (
      candNorm === spec.fullNormalizedQuery
      || candExplicitNumNorm === spec.fullExplicitNumeralNormalizedQuery
    )
  ) {
    evidence.matchType = "exact";
    evidence.exactTitleMatch = true;
    evidence.yearPartOfTitle = true;
    evidence.yearCompatibility = "in-title";
    baseScore = 0.92;
    reasons.push("Exact normalized title match (trailing number is part of title)");
  }
  // 2B. Exact match against raw query before noise stripping (preserves literal titles containing noise words)
  else if (
    spec.strippedNoise.length > 0
    && spec.rawNormalizedQuery
    && candNorm === spec.rawNormalizedQuery
  ) {
    evidence.matchType = "exact";
    evidence.exactTitleMatch = true;
    baseScore = 0.92;
    reasons.push("Exact normalized title match on unstripped query");
  }
  // 2C. Exact title match (including explicit installment markers like "Part II" <-> "Part 2", "Episode IV" <-> "Episode 4")
  else if (candNorm === spec.normalizedQuery || candExplicitNumNorm === spec.explicitNumeralNormalizedQuery) {
    evidence.matchType = "exact";
    evidence.exactTitleMatch = true;
    baseScore = 0.92;
    reasons.push("Exact normalized title match");
  }
  // 2D. Bare trailing Roman/Arabic numeral variant (e.g., "Ocean IV" <-> "Ocean 4", "Rocky IV" <-> "Rocky 4"):
  //     preserved as a strong conservative candidate, never high-confidence exact auto-selection.
  else if (
    candNumNorm === spec.numeralNormalizedQuery
    || (spec.yearHintSource === "trailing" && spec.fullNumeralNormalizedQuery && candNumNorm === spec.fullNumeralNormalizedQuery)
  ) {
    evidence.matchType = "sequel-numeral-variant";
    evidence.exactTitleMatch = false;
    baseScore = 0.78;
    reasons.push("Bare trailing numeral variant kept conservative (capped at medium confidence)");
  }
  // 3. Explicit curated alias match (strictly media-type-scoped + title sanity validated on IMDb IDs)
  else {
    const idConflictEntry = spec.aliasCandidates.find(entry =>
      entry.mediaTypes.includes(targetMediaType)
      && (entry.imdbIds || []).includes(imdbId)
      && entry.canonicalKey !== candNorm
      && !isAliasTitleConsistent(entry, rawTitle)
    );

    const matchingAliasEntry = !idConflictEntry && (
      spec.aliasCandidates.find(entry =>
        entry.mediaTypes.includes(targetMediaType)
        && (
          entry.canonicalKey === candNorm
          || ((entry.imdbIds || []).includes(imdbId) && isAliasTitleConsistent(entry, rawTitle))
        )
      ) || knownAliasEntries.find(entry =>
        entry.mediaTypes.includes(targetMediaType)
        && entry.normalizedAliases.includes(spec.normalizedQuery)
        && isAliasTitleConsistent(entry, rawTitle)
      )
    );

    const altMatchesQuery = alt => (
      alt.norm === spec.normalizedQuery
      || alt.explicitNumNorm === spec.explicitNumeralNormalizedQuery
      || (spec.yearHintSource === "trailing" && alt.norm === spec.fullNormalizedQuery)
    );

    if (idConflictEntry) {
      evidence.matchType = "alias-title-conflict";
      evidence.aliasTitleConflict = true;
      baseScore = 0.35;
      reasons.push(`Candidate IMDb ID matched alias "${idConflictEntry.canonicalTitle}", but candidate title "${rawTitle}" contradicts it`);
    } else if (matchingAliasEntry) {
      evidence.matchType = "alias";
      evidence.aliasMatch = true;
      if (matchingAliasEntry.ambiguousFranchise) {
        evidence.franchiseAmbiguous = true;
        baseScore = 0.78;
        reasons.push(`Franchise-level ${targetMediaType} alias match ("${matchingAliasEntry.canonicalTitle}") — requires installment or year disambiguation`);
      } else {
        baseScore = 0.88;
        reasons.push(`Verified ${targetMediaType} alias match`);
      }
    }
    // 4A. Explicitly verified alternate-title field present on candidate metadata
    else if (verifiedAlts.some(altMatchesQuery)) {
      evidence.matchType = "alternate-title";
      evidence.alternateTitleMatch = true;
      evidence.alternateTitleVerified = true;
      if (spec.yearHintSource === "trailing" && verifiedAlts.some(alt => alt.norm === spec.fullNormalizedQuery)) {
        evidence.yearPartOfTitle = true;
        evidence.yearCompatibility = "in-title";
      }
      baseScore = 0.88;
      reasons.push("Exact match on verified candidate alternate title");
    }
    // 4B. Unverified upstream alternate-title metadata (NEVER qualifies for high confidence or auto-selection)
    else if (unverifiedAlts.some(altMatchesQuery)) {
      evidence.matchType = "unverified-alternate-title";
      evidence.unverifiedAlternateTitleMatch = true;
      evidence.alternateTitleVerified = false;
      if (spec.yearHintSource === "trailing" && unverifiedAlts.some(alt => alt.norm === spec.fullNormalizedQuery)) {
        evidence.yearPartOfTitle = true;
        evidence.yearCompatibility = "in-title";
      }
      const primaryAlign = evaluateTokenAlignment(spec.tokens, candTokens);
      const primarySim = normalizedSimilarity(spec.normalizedQuery, candNorm).similarity;
      const primaryCompactMatch = spec.normalizedQuery.replace(/\s+/g, "") === candNorm.replace(/\s+/g, "");
      unverifiedAltHasPrimarySupport = Boolean(
        primaryCompactMatch
        || primaryAlign.significantExactHits >= 1
        || primarySim >= 0.55
      );
      if (unverifiedAltHasPrimarySupport) {
        baseScore = 0.72;
        reasons.push("Match on unverified upstream alternate title with primary-title alignment (capped at medium; no auto-select)");
      } else {
        baseScore = 0.45;
        reasons.push("Match on unverified upstream alternate title with unrelated primary title (capped at low; no auto-select)");
      }
    }
    // 5. Leading-article exact variant ("bear" <-> "the bear")
    else if (
      stripLeadingArticle(candNorm) === stripLeadingArticle(spec.normalizedQuery)
      && stripLeadingArticle(spec.normalizedQuery).length >= 3
    ) {
      evidence.matchType = "exact-article-variant";
      evidence.exactTitleMatch = true;
      if (spec.isShortQuery) {
        evidence.shortTitleGuardApplied = true;
        baseScore = 0.76;
        reasons.push("Short-title leading-article variant kept conservative");
      } else {
        baseScore = 0.85;
        reasons.push("Exact title match ignoring leading article");
      }
    }
    else {
      // 6. Token alignment, prefix, and conservative typo evaluation
      const alignment = evaluateTokenAlignment(spec.tokens, candTokens);
      evidence.tokenSimilarity = Number(alignment.jaccard.toFixed(4));
      evidence.orderedTokenCoverage = Number(alignment.orderedCoverage.toFixed(4));

      const { distance, similarity } = normalizedSimilarity(spec.normalizedQuery, candNorm);
      evidence.editDistance = distance;
      evidence.typoSimilarity = Number(similarity.toFixed(4));

      const isSingleSigQuery = spec.significantTokens.length === 1;
      const singleSigLen = isSingleSigQuery ? spec.significantTokens[0].length : 0;
      const isShortSingleSigTypo = isSingleSigQuery && singleSigLen <= 7;

      const isTokenPrefix = candNorm.startsWith(`${spec.normalizedQuery} `)
        || stripLeadingArticle(candNorm).startsWith(`${spec.normalizedQuery} `);

      if (alignment.stopwordOnly) {
        baseScore = 0.05;
        reasons.push("Only stopword tokens overlapped");
      } else if (isTokenPrefix && !alignment.stopwordOnly) {
        evidence.prefixMatch = true;
        evidence.matchType = "prefix";
        const lengthRatio = Math.min(1, spec.normalizedQuery.length / candNorm.length);
        baseScore = 0.62 + 0.20 * lengthRatio;
        if (spec.isShortQuery) {
          evidence.shortTitleGuardApplied = true;
          baseScore = Math.min(baseScore, 0.72);
          reasons.push("Short-title prefix match kept conservative");
        } else {
          reasons.push("Full-token prefix match");
        }
      } else if (alignment.exactHits > 0 && alignment.typoHits === 0) {
        // Pure exact-token overlap (partial or reordered match); stays strictly below exact/alias matches
        const sigQueryCount = Math.max(1, spec.significantTokens.length);
        const sigRecall = alignment.significantExactHits / sigQueryCount;
        evidence.matchType = "token-overlap";
        baseScore = Math.min(
          0.78,
          0.15 + (0.35 * sigRecall) + (0.22 * alignment.jaccard) + (0.08 * alignment.orderedCoverage)
        );
        if (spec.isShortQuery) {
          evidence.shortTitleGuardApplied = true;
          baseScore = Math.min(baseScore, 0.68);
          reasons.push("Short-title partial match capped conservatively");
        } else {
          reasons.push(`Exact token overlap (${alignment.exactHits}/${spec.tokens.length} tokens)`);
        }
      } else if (alignment.typoHits > 0) {
        const totalMatched = alignment.exactHits + alignment.typoHits;
        const recall = totalMatched / spec.tokens.length;
        const candCoverage = totalMatched / candTokens.length;

        // Guard 1: Short queries (<= 4 chars) never accept typo matches.
        if (spec.isShortQuery) {
          evidence.shortTitleGuardApplied = true;
          evidence.typoOnlyCapped = true;
          evidence.matchType = "typo-rejected";
          baseScore = 0.22;
          reasons.push("Short-title typo guard prevented false match");
        }
        // Guard 2: Queries with only a single significant token of length <= 7 (even with stopwords
        // like "the castle" vs "The Cattle", or 7-char neighbors like "chapter"/"charter",
        // "monster"/"mobster", "martial"/"marital") stay strictly capped at low confidence.
        else if (isShortSingleSigTypo) {
          evidence.shortTitleGuardApplied = true;
          evidence.typoOnlyCapped = true;
          evidence.matchType = "weak-typo";
          baseScore = Math.min(0.46, 0.25 + 0.22 * similarity);
          reasons.push(`Single significant token (${singleSigLen}-character) typo match capped at low confidence`);
        } else {
          const baseBeforeColon = rawTitle.includes(":") ? normalizeTitleText(rawTitle.split(":")[0]) : "";
          const baseTokens = baseBeforeColon ? tokenizeTitle(baseBeforeColon) : [];
          const baseSim = baseBeforeColon ? normalizedSimilarity(spec.normalizedQuery, baseBeforeColon) : null;
          const baseCoverage = baseTokens.length > 0 ? totalMatched / baseTokens.length : 0;

          // Multi-significant-token typos MUST be anchored by at least one exact significant token
          // (stopwords such as "the" NEVER satisfy the anchor requirement).
          // Single-significant-token typos (len >= 8) require matching significant-token initial and >= 0.78 similarity.
          let hasAnchor = false;
          if (isSingleSigQuery) {
            const qSig = spec.significantTokens[0];
            const cSig = candSignificantTokens[0] || "";
            const sigSim = cSig ? normalizedSimilarity(qSig, cSig).similarity : 0;
            hasAnchor = Boolean(cSig && qSig[0] === cSig[0] && sigSim >= 0.78);
          } else {
            hasAnchor = alignment.significantExactHits >= 1;
          }

          const isStrongFullTypo = hasAnchor && recall >= 0.8 && candCoverage >= 0.6 && similarity >= 0.72;
          const isStrongBaseTypo = Boolean(
            hasAnchor
            && baseBeforeColon
            && baseBeforeColon.length >= 5
            && recall >= 0.8
            && baseCoverage >= 0.8
            && baseSim
            && baseSim.similarity >= 0.78
          );

          if (isStrongFullTypo || isStrongBaseTypo) {
            const effectiveSim = isStrongBaseTypo && !isStrongFullTypo ? baseSim.similarity : similarity;
            const effectiveDist = isStrongBaseTypo && !isStrongFullTypo ? baseSim.distance : distance;
            evidence.matchType = "typo";
            evidence.typoOnlyCapped = true;
            evidence.editDistance = effectiveDist;
            evidence.typoSimilarity = Number(effectiveSim.toFixed(4));
            // Spelling similarity alone NEVER exceeds medium confidence (score <= 0.78).
            baseScore = Math.min(0.78, 0.54 + 0.22 * effectiveSim + 0.06 * alignment.significantExactHits);
            reasons.push(`Typo-tolerant match capped below high confidence (edit distance ${effectiveDist})`);
          } else {
            evidence.matchType = "weak-typo";
            evidence.typoOnlyCapped = true;
            baseScore = Math.min(0.42, 0.20 + 0.25 * alignment.jaccard);
            reasons.push(`Weak typo similarity (edit distance ${distance})`);
          }
        }
      } else {
        // Whole-string check for missing/extra spaces ("breakingbad" -> "breaking bad")
        // or long single-significant-token typos (length >= 8).
        const compactQuery = spec.normalizedQuery.replace(/\s+/g, "");
        const compactCand = candNorm.replace(/\s+/g, "");
        const compactSim = normalizedSimilarity(compactQuery, compactCand);

        if (compactQuery === compactCand && compactQuery.length >= 5) {
          evidence.matchType = "spacing-variant";
          evidence.typoOnlyCapped = true;
          evidence.editDistance = distance;
          evidence.typoSimilarity = 1;
          baseScore = 0.78;
          reasons.push("Exact match ignoring spacing differences (capped at medium confidence)");
        } else if (spec.isShortQuery) {
          evidence.shortTitleGuardApplied = true;
          evidence.matchType = "none";
          baseScore = 0.10 * similarity;
          reasons.push("Short query requires exact or prefix match");
        } else if (
          !isShortSingleSigTypo
          && compactQuery.length >= 8
          && spec.significantTokens.length >= 1
          && candSignificantTokens.length >= 1
          && spec.significantTokens[0][0] === candSignificantTokens[0][0]
          && compactSim.distance <= 2
          && compactSim.similarity >= 0.80
        ) {
          evidence.matchType = "typo";
          evidence.typoOnlyCapped = true;
          evidence.editDistance = compactSim.distance;
          evidence.typoSimilarity = Number(compactSim.similarity.toFixed(4));
          baseScore = Math.min(0.76, 0.55 + 0.22 * compactSim.similarity);
          reasons.push(`Whole-title typo match capped below high confidence (edit distance ${compactSim.distance})`);
        } else {
          evidence.matchType = "none";
          baseScore = Math.min(0.25, similarity * 0.30);
          reasons.push("Insufficient lexical evidence");
        }
      }
    }
  }

  // 7. Year compatibility (remake disambiguation) — skipped when year is part of the matched title itself.
  let yearAdjustment = 0;
  if (spec.yearHint !== null && !evidence.yearPartOfTitle) {
    if (candYear === null) {
      evidence.yearCompatibility = "unknown";
      reasons.push(`Candidate missing release year (requested ${spec.yearHint})`);
    } else if (candYear === spec.yearHint) {
      evidence.yearCompatibility = "exact";
      yearAdjustment = 0.12;
      reasons.push(`Exact release year match (${candYear})`);
    } else if (Math.abs(candYear - spec.yearHint) === 1) {
      evidence.yearCompatibility = "close";
      yearAdjustment = 0.03;
      reasons.push(`Close release year (${candYear} vs ${spec.yearHint})`);
    } else {
      evidence.yearCompatibility = "mismatch";
      yearAdjustment = -0.38;
      reasons.push(`Substantial release year mismatch (${candYear} vs ${spec.yearHint})`);
    }
  }

  // 8. Small metadata completeness tie-breaker (max +0.04; never rescues irrelevant candidates)
  const completeness = computeMetadataCompleteness(candidate);
  evidence.metadataCompleteness = completeness.bonus;
  const completenessBonus = baseScore >= 0.45 ? completeness.bonus : 0;

  let finalScore = roundScore(baseScore + yearAdjustment + completenessBonus);

  // Hard cap 1: spelling similarity alone must NEVER produce a high-confidence score.
  if (evidence.typoOnlyCapped) {
    finalScore = Math.min(finalScore, 0.79);
  }
  // Hard cap 2: single-significant-token <= 7 char and weak typo matches stay strictly in low confidence.
  if (evidence.matchType === "weak-typo") {
    finalScore = Math.min(finalScore, 0.48);
  }
  // Hard cap 3: bare trailing numeral variants ("Ocean IV" vs "Ocean 4") stay below high confidence.
  if (evidence.matchType === "sequel-numeral-variant") {
    finalScore = Math.min(finalScore, 0.79);
  }
  // Hard cap 4: unverified upstream alternate titles NEVER reach high confidence; unrelated primary stays low.
  if (evidence.unverifiedAlternateTitleMatch) {
    finalScore = Math.min(finalScore, unverifiedAltHasPrimarySupport ? 0.74 : 0.48);
  }
  // Hard cap 5: alias IMDb ID contradicting candidate title stays capped at low confidence.
  if (evidence.aliasTitleConflict) {
    finalScore = Math.min(finalScore, 0.35);
  }
  // Hard cap 6: missing verified media type ("unknown") NEVER reaches high confidence or auto-selection.
  if (evidence.mediaTypeStatus === "unknown") {
    finalScore = Math.min(finalScore, 0.78);
    reasons.push("Candidate missing verified media type; capped below high confidence");
  }
  // Hard cap 7: short-title leading-article variants without an exact year match stay below high.
  if (evidence.matchType === "exact-article-variant" && evidence.shortTitleGuardApplied && evidence.yearCompatibility !== "exact") {
    finalScore = Math.min(finalScore, 0.79);
  }
  // Hard cap 8: franchise-level aliases without an exact year disambiguator stay below high.
  if (evidence.franchiseAmbiguous && evidence.yearCompatibility !== "exact") {
    finalScore = Math.min(finalScore, 0.79);
  }
  // Hard cap 9: substantial release-year mismatch (>= 2 years off) is capped at low confidence.
  if (evidence.yearCompatibility === "mismatch") {
    finalScore = Math.min(finalScore, 0.54);
  }

  evidence.score = roundScore(finalScore);

  // Conservative confidence classification
  const hasHighEligibleEvidence = evidence.exactTitleMatch
    || evidence.aliasMatch
    || evidence.alternateTitleMatch
    || evidence.imdbIdMatch;

  const blockedFromHigh = evidence.typoOnlyCapped
    || evidence.yearCompatibility === "mismatch"
    || evidence.mediaTypeStatus !== "match"
    || evidence.unverifiedAlternateTitleMatch
    || evidence.aliasTitleConflict
    || evidence.matchType === "sequel-numeral-variant"
    || (evidence.franchiseAmbiguous && evidence.yearCompatibility !== "exact")
    || (evidence.matchType === "exact-article-variant" && evidence.shortTitleGuardApplied && evidence.yearCompatibility !== "exact");

  if (evidence.score >= 0.85 && hasHighEligibleEvidence && !blockedFromHigh) {
    evidence.confidence = "high";
  } else if (evidence.score >= 0.62) {
    evidence.confidence = "medium";
  } else if (evidence.score >= 0.35) {
    evidence.confidence = "low";
  } else {
    evidence.confidence = "none";
  }

  return evidence;
}

function compareRankedEntries(a, b) {
  if (b.evidence.score !== a.evidence.score) return b.evidence.score - a.evidence.score;
  const exactA = a.evidence.exactTitleMatch || a.evidence.aliasMatch || a.evidence.alternateTitleMatch ? 1 : 0;
  const exactB = b.evidence.exactTitleMatch || b.evidence.aliasMatch || b.evidence.alternateTitleMatch ? 1 : 0;
  if (exactB !== exactA) return exactB - exactA;
  const yearA = a.evidence.yearCompatibility === "exact" ? 1 : 0;
  const yearB = b.evidence.yearCompatibility === "exact" ? 1 : 0;
  if (yearB !== yearA) return yearB - yearA;
  const ratingA = Number(a.candidate.rating ?? a.candidate.imdbRating) || 0;
  const ratingB = Number(b.candidate.rating ?? b.candidate.imdbRating) || 0;
  if (ratingB !== ratingA) return ratingB - ratingA;
  return String(a.candidate.imdbId || "").localeCompare(String(b.candidate.imdbId || ""));
}

export function rankCandidates(queryOrSpec, rawCandidates = [], mediaType) {
  const isPreparsedSpec = Boolean(queryOrSpec && typeof queryOrSpec === "object");
  const targetMediaType = normalizeMediaType(
    mediaType !== undefined
      ? mediaType
      : (isPreparsedSpec ? queryOrSpec.mediaType : "series")
  );
  const spec = isPreparsedSpec
    ? queryOrSpec
    : parseSearchQuery(queryOrSpec, targetMediaType);

  const deduped = deduplicateCandidates(rawCandidates, targetMediaType);
  const scored = deduped.map(candidate => ({
    candidate,
    evidence: scoreCandidate(spec, candidate, targetMediaType)
  }));

  scored.sort(compareRankedEntries);

  const top = scored[0] || null;
  const second = scored[1] || null;

  let ambiguous = false;
  let ambiguityReason = "";

  // 0. Franchise-level alias (e.g. "LOTR", "HxH" without year) is inherently ambiguous even if only 1 installment returned.
  if (top && top.evidence.franchiseAmbiguous && top.evidence.yearCompatibility !== "exact") {
    ambiguous = true;
    ambiguityReason = `Alias "${spec.rawQuery}" refers to multiple installments or versions. Specify a fuller title or release year.`;
  } else if (top && second && top.evidence.score >= 0.55) {
    const topNorm = normalizeTitleText(top.candidate.title || top.candidate.name);
    const secondNorm = normalizeTitleText(second.candidate.title || second.candidate.name);
    const topYear = top.evidence.candidateYear;
    const secondYear = second.evidence.candidateYear;

    const explicitlyYearDisambiguated = Boolean(
      spec.yearHint !== null
      && !top.evidence.yearPartOfTitle
      && (top.evidence.exactTitleMatch || top.evidence.aliasMatch || top.evidence.alternateTitleMatch)
      && top.evidence.yearCompatibility === "exact"
      && second.evidence.yearCompatibility !== "exact"
    );

    // 1. Remake / identical title collision across different years when user gave no year
    if (
      topNorm === secondNorm
      && spec.yearHint === null
      && topYear !== null
      && secondYear !== null
      && topYear !== secondYear
    ) {
      ambiguous = true;
      ambiguityReason = `Multiple ${targetMediaType === "movie" ? "movies" : "series"} match "${top.candidate.title}" (${[topYear, secondYear].sort((a, b) => b - a).join(", ")}). Include a release year to disambiguate.`;
    }
    // 2. Close competing strong matches (unless top won via explicit exact-year disambiguation)
    else if (
      !explicitlyYearDisambiguated
      && second.evidence.score >= 0.62
      && (top.evidence.score - second.evidence.score) <= 0.08
    ) {
      ambiguous = true;
      ambiguityReason = `Multiple strong candidates closely match "${spec.rawQuery}".`;
    }
    // 3. Short query with multiple plausible hits (unless explicitly disambiguated by exact title + exact year)
    else if (
      !explicitlyYearDisambiguated
      && spec.isShortQuery
      && second.evidence.score >= 0.55
    ) {
      ambiguous = true;
      ambiguityReason = `Short query "${spec.rawQuery}" matches multiple titles.`;
    }
  }

  let confidence = top ? top.evidence.confidence : "none";
  // Keep top candidate's evidence confidence internally consistent with outcome.confidence on ambiguity downgrade.
  if (ambiguous && top && top.evidence.confidence === "high") {
    top.evidence.confidence = "medium";
    top.evidence.ambiguityDowngraded = true;
    top.evidence.reasons.push("Confidence downgraded from high to medium due to competing candidates");
    confidence = "medium";
  }

  const exactMatch = Boolean(top && !ambiguous && (
    top.evidence.exactTitleMatch
    || top.evidence.aliasMatch
    || top.evidence.alternateTitleMatch
    || top.evidence.imdbIdMatch
  ) && confidence === "high");

  // Never silently collapse or redirect an ambiguous query to a single item.
  const selectedCandidate = (!ambiguous && confidence === "high" && top) ? top.candidate : null;

  const needsFallback = spec.plausible
    ? (confidence === "none" || confidence === "low")
    : Boolean(spec.nonLatinScript);

  return {
    querySpec: spec,
    ranked: scored,
    results: scored.map(entry => entry.candidate),
    topCandidate: top ? top.candidate : null,
    topScore: top ? top.evidence.score : 0,
    confidence,
    exactMatch,
    ambiguous,
    ambiguityReason,
    selectedCandidate,
    needsFallback
  };
}
