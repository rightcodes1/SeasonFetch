import test from "node:test";
import assert from "node:assert/strict";
import {
  TITLE_ALIAS_ENTRIES,
  getKnownAliasesForCandidate,
  lookupTitleAliases,
  normalizeAliasKey
} from "../services/titleAliases.js";
import {
  damerauLevenshtein,
  deduplicateCandidates,
  isPlausibleSearchQuery,
  normalizeExplicitInstallmentNumerals,
  normalizeNumerals,
  normalizeTitleText,
  parseCandidateYear,
  parseSearchQuery,
  rankCandidates,
  scoreCandidate
} from "../services/titleResolution.js";

function makeCandidate(overrides = {}) {
  return {
    id: overrides.id || overrides.imdbId || "tt0000001",
    imdbId: overrides.imdbId || overrides.id || "tt0000001",
    title: overrides.title || "Untitled",
    year: overrides.year ?? "2020",
    rating: overrides.rating ?? "8.0",
    type: overrides.type || "Drama",
    synopsis: overrides.synopsis || "Synopsis text.",
    genres: overrides.genres || ["Drama"],
    poster: overrides.poster ?? "https://images.test/poster.jpg",
    mediaType: overrides.mediaType || "series",
    ...overrides
  };
}

test("normalization handles Unicode, punctuation, spacing, and strictly contextual Roman numerals", () => {
  assert.equal(normalizeTitleText("  Amélie  "), "amelie");
  assert.equal(normalizeTitleText("Pokémon: Indigo League"), "pokemon indigo league");
  assert.equal(normalizeTitleText("Howl’s Moving Castle"), "howls moving castle");
  assert.equal(normalizeTitleText("The.Bear_2022"), "the bear 2022");
  assert.equal(normalizeTitleText("Law & Order: SVU"), "law and order svu");
  assert.equal(normalizeTitleText("Spider-Man — No Way Home"), "spider man no way home");
  assert.equal(normalizeAliasKey("Steins;Gate"), "steins gate");

  // Punctuated initialisms (M1) collapse cleanly without breaking regular titles
  assert.equal(normalizeTitleText("S.W.A.T."), "swat");
  assert.equal(normalizeTitleText("M*A*S*H"), "mash");
  assert.equal(normalizeTitleText("Agents of S.H.I.E.L.D."), "agents of shield");
  assert.equal(normalizeTitleText("Mr. Robot"), "mr robot");
  assert.equal(normalizeTitleText("The.Bear"), "the bear");

  const swatMatch = rankCandidates("S.W.A.T.", [
    makeCandidate({ imdbId: "tt6111130", title: "SWAT", year: "2017", rating: "7.2", mediaType: "series" })
  ], "series");
  assert.equal(swatMatch.confidence, "high");
  assert.equal(swatMatch.selectedCandidate.imdbId, "tt6111130");

  const mashMatch = rankCandidates("M*A*S*H", [
    makeCandidate({ imdbId: "tt0068098", title: "MASH", year: "1972", rating: "8.4", mediaType: "series" })
  ], "series");
  assert.equal(mashMatch.confidence, "high");
  assert.equal(mashMatch.selectedCandidate.imdbId, "tt0068098");

  // Short-title guard still prevents "SWAT" from matching "SEAT"
  const swatTypoTrap = rankCandidates("SWAT", [
    makeCandidate({ imdbId: "tt9009001", title: "SEAT", year: "2020", mediaType: "series" })
  ], "series");
  assert.ok(swatTypoTrap.confidence === "low" || swatTypoTrap.confidence === "none");
  assert.equal(swatTypoTrap.selectedCandidate, null);

  // Explicit installment contexts convert Roman -> Arabic for high-confidence exact matches
  assert.equal(normalizeExplicitInstallmentNumerals("dune part ii"), "dune part 2");
  assert.equal(normalizeExplicitInstallmentNumerals("star wars episode iv"), "star wars episode 4");
  assert.equal(normalizeExplicitInstallmentNumerals("ocean iv"), "ocean iv");
  assert.equal(normalizeNumerals("dune part ii"), "dune part 2");
  assert.equal(normalizeNumerals("rocky iv"), "rocky 4");
  assert.equal(normalizeNumerals("star wars episode iv"), "star wars episode 4");
  assert.equal(normalizeNumerals("final fantasy vii"), "final fantasy 7");

  // M5: Explicit installment marker ("Dune Part II" vs "Dune: Part 2") reaches high;
  // bare trailing Roman numeral ("Ocean IV" vs "Ocean 4") stays conservative at medium (no auto-select).
  const dunePart2Exact = rankCandidates("Dune Part II", [
    makeCandidate({ imdbId: "tt15239678", title: "Dune: Part 2", year: "2024", rating: "8.5", mediaType: "movie" })
  ], "movie");
  assert.equal(dunePart2Exact.confidence, "high");
  assert.equal(dunePart2Exact.selectedCandidate.imdbId, "tt15239678");

  const oceanVariant = rankCandidates("Ocean IV", [
    makeCandidate({ imdbId: "tt9009002", title: "Ocean 4", year: "2020", mediaType: "movie" })
  ], "movie");
  assert.equal(oceanVariant.ranked[0].evidence.matchType, "sequel-numeral-variant");
  assert.equal(oceanVariant.confidence, "medium");
  assert.equal(oceanVariant.selectedCandidate, null);

  // Standalone Roman numerals and single-letter tokens MUST NOT be converted
  assert.equal(normalizeNumerals("vi"), "vi");
  assert.equal(normalizeNumerals("ix"), "ix");
  assert.equal(normalizeNumerals("iv"), "iv");
  assert.equal(normalizeNumerals("ii"), "ii");
  assert.equal(normalizeNumerals("hunter x hunter"), "hunter x hunter");
  assert.equal(normalizeNumerals("batman v superman"), "batman v superman");
  assert.equal(normalizeNumerals("i robot"), "i robot");

  // Standalone Roman-numeral titles must NEVER collide with numeric titles ("VI" vs "6", "IX" vs "9", "IV" vs "4")
  assert.equal(scoreCandidate("VI", makeCandidate({ title: "6", mediaType: "movie" }), "movie").confidence, "none");
  assert.equal(scoreCandidate("IX", makeCandidate({ title: "9", year: "2009", mediaType: "movie" }), "movie").confidence, "none");
  assert.equal(scoreCandidate("IV", makeCandidate({ title: "4", mediaType: "movie" }), "movie").confidence, "none");

  // Ordinary numeric titles MUST NOT generate nonsensical Roman-numeral search variants
  const fast2 = parseSearchQuery("2 Fast 2 Furious", "movie");
  assert.equal(fast2.searchQueries.some(v => /ii/.test(v.normalized)), false);
  const district9 = parseSearchQuery("District 9", "movie");
  assert.equal(district9.searchQueries.some(v => /\bix\b/.test(v.normalized)), false);

  // Genuine installment keyword ("Dune Part 2", "Star Wars: Episode 4") DOES get a Roman variant
  const dunePart2 = parseSearchQuery("Dune Part 2", "movie");
  assert.ok(dunePart2.searchQueries.some(v => v.normalized === "dune part ii"));
  const sw4 = parseSearchQuery("Star Wars: Episode 4", "movie");
  assert.ok(sw4.searchQueries.some(v => v.normalized === "star wars episode iv"));
});

test("query parser preserves legitimate numeric/year titles and avoids corrupting title words during noise stripping", () => {
  // Direct IMDb ID & URL
  const imdbRaw = parseSearchQuery("  TT0903747 ", "series");
  assert.equal(imdbRaw.isDirectImdbLookup, true);
  assert.equal(imdbRaw.imdbId, "tt0903747");

  const imdbUrl = parseSearchQuery("https://www.imdb.com/title/tt2543164/?ref_=nv_sr_srsg_0", "movie");
  assert.equal(imdbUrl.isDirectImdbLookup, true);
  assert.equal(imdbUrl.imdbId, "tt2543164");

  // Explicit parenthesized year hint
  const duneExplicit = parseSearchQuery("Dune (2021)", "movie");
  assert.equal(duneExplicit.normalizedQuery, "dune");
  assert.equal(duneExplicit.yearHint, 2021);
  assert.equal(duneExplicit.yearHintSource, "explicit");

  // Trailing bare year preserves BOTH fullNormalizedQuery and yearHint
  const ww84 = parseSearchQuery("Wonder Woman 1984", "movie");
  assert.equal(ww84.fullNormalizedQuery, "wonder woman 1984");
  assert.equal(ww84.normalizedQuery, "wonder woman");
  assert.equal(ww84.yearHint, 1984);
  assert.equal(ww84.yearHintSource, "trailing");
  assert.ok(ww84.searchQueries.some(v => v.normalized === "wonder woman 1984"));

  // Titles legitimately ending in a 4-digit year match themselves at HIGH confidence without mismatch penalty
  const wwOutcome = rankCandidates("Wonder Woman 1984", [
    makeCandidate({ imdbId: "tt0451279", title: "Wonder Woman", year: "2017", rating: "7.4", mediaType: "movie" }),
    makeCandidate({ imdbId: "tt7126948", title: "Wonder Woman 1984", year: "2020", rating: "5.4", mediaType: "movie" })
  ], "movie");
  assert.equal(wwOutcome.topCandidate.imdbId, "tt7126948");
  assert.equal(wwOutcome.confidence, "high");
  assert.equal(wwOutcome.ambiguous, false);
  assert.equal(wwOutcome.ranked[0].evidence.yearPartOfTitle, true);
  assert.equal(wwOutcome.ranked[0].evidence.yearCompatibility, "in-title");

  const dr2000 = rankCandidates("Death Race 2000", [
    makeCandidate({ imdbId: "tt0452608", title: "Death Race", year: "2008", rating: "6.4", mediaType: "movie" }),
    makeCandidate({ imdbId: "tt0072856", title: "Death Race 2000", year: "1975", rating: "6.2", mediaType: "movie" })
  ], "movie");
  assert.equal(dr2000.topCandidate.imdbId, "tt0072856");
  assert.equal(dr2000.confidence, "high");
  assert.equal(dr2000.ranked[0].evidence.yearPartOfTitle, true);

  const space1999 = rankCandidates("Space: 1999", [
    makeCandidate({ imdbId: "tt0072564", title: "Space: 1999", year: "1975-1977", rating: "7.3", mediaType: "series" }),
    makeCandidate({ imdbId: "tt9000099", title: "Space", year: "1985", rating: "6.0", mediaType: "series" })
  ], "series");
  assert.equal(space1999.topCandidate.imdbId, "tt0072564");
  assert.equal(space1999.confidence, "high");
  assert.equal(space1999.ranked[0].evidence.yearPartOfTitle, true);

  // Numeric-only, leading-year, and future-year titles stay intact
  assert.equal(parseSearchQuery("1917", "movie").normalizedQuery, "1917");
  assert.equal(parseSearchQuery("1917", "movie").yearHint, null);
  assert.equal(parseSearchQuery("1899", "series").normalizedQuery, "1899");
  assert.equal(parseSearchQuery("2001: A Space Odyssey", "movie").yearHint, null);
  assert.equal(parseSearchQuery("Blade Runner 2049", "movie").yearHint, null);

  // Conservative trailing noise stripping: strips watch tags, NEVER strips "Star Wars: Episode 4" or "Season of the Witch"
  const noisy = parseSearchQuery("Breaking Bad Season 2 1080p English Dub", "series");
  assert.equal(noisy.normalizedQuery, "breaking bad");
  assert.ok(noisy.strippedNoise.includes("season"));
  assert.ok(noisy.strippedNoise.includes("resolution"));
  assert.ok(noisy.strippedNoise.includes("audio-tag"));

  const starWarsEp4 = parseSearchQuery("Star Wars: Episode 4", "movie");
  assert.equal(starWarsEp4.normalizedQuery, "star wars episode 4");
  assert.deepEqual(starWarsEp4.strippedNoise, []);
  const swMatch = rankCandidates(starWarsEp4, [
    makeCandidate({ imdbId: "tt0076759", title: "Star Wars: Episode IV", year: "1977", rating: "8.6", mediaType: "movie" }),
    makeCandidate({ imdbId: "tt0120915", title: "Star Wars: Episode I", year: "1999", rating: "6.5", mediaType: "movie" })
  ]);
  assert.equal(swMatch.topCandidate.imdbId, "tt0076759");
  assert.equal(swMatch.confidence, "high");

  // M2: Trailing bare year puts stripped normalizedQuery FIRST ahead of fullNormalizedQuery
  const duneTrailing = parseSearchQuery("Dune 2021", "movie");
  assert.equal(duneTrailing.searchQueries[0].normalized, "dune");
  assert.ok(duneTrailing.searchQueries.some(v => v.normalized === "dune 2021"));

  // M2: Single stripped trailing qualifier preserves raw unstripped query as secondary variant ("Life in 4K")
  const lifeIn4kSpec = parseSearchQuery("Life in 4K", "series");
  assert.equal(lifeIn4kSpec.normalizedQuery, "life in");
  assert.ok(lifeIn4kSpec.searchQueries.some(v => v.normalized === "life in 4k" && v.reason === "raw-unstripped"));
  const lifeIn4kMatch = rankCandidates(lifeIn4kSpec, [
    makeCandidate({ imdbId: "tt9009003", title: "Life in 4K", year: "2021", mediaType: "series" })
  ]);
  assert.equal(lifeIn4kMatch.confidence, "high");
  assert.equal(lifeIn4kMatch.selectedCandidate.imdbId, "tt9009003");

  assert.equal(parseSearchQuery("Season of the Witch", "movie").normalizedQuery, "season of the witch");
  assert.deepEqual(parseSearchQuery("Season of the Witch", "movie").strippedNoise, []);

  // Empty & non-Latin queries degrade cleanly without crashing
  assert.equal(isPlausibleSearchQuery(""), false);
  assert.equal(isPlausibleSearchQuery("   "), false);
  assert.equal(isPlausibleSearchQuery("aaaaaa"), false);
  assert.equal(isPlausibleSearchQuery("zxqwkjhgf"), false);

  for (const nonLatin of ["進撃の巨人", "君の名は", "오징어 게임"]) {
    const spec = parseSearchQuery(nonLatin, "series");
    assert.equal(spec.nonLatinScript, true);
    assert.equal(spec.plausible, false);
    const outcome = rankCandidates(spec, [makeCandidate({ title: "Attack on Titan", imdbId: "tt2560140" })]);
    assert.equal(outcome.confidence, "none");
    assert.equal(outcome.selectedCandidate, null);
    assert.equal(outcome.needsFallback, true);
  }
});

test("pre-parsed movie query specs preserve spec.mediaType when 3rd mediaType argument is omitted", () => {
  const movieSpec = parseSearchQuery("Arrival", "movie");
  const movieCand = makeCandidate({ imdbId: "tt2543164", title: "Arrival", year: "2016", mediaType: "movie" });
  const seriesCand = makeCandidate({ imdbId: "tt9999999", title: "Arrival", year: "2016", mediaType: "series" });

  // Omitting 3rd argument MUST inherit movieSpec.mediaType ("movie"), NOT default to "series"
  const scoredMovie = scoreCandidate(movieSpec, movieCand);
  assert.equal(scoredMovie.mediaTypeCompatible, true);
  assert.equal(scoredMovie.confidence, "high");

  const scoredSeries = scoreCandidate(movieSpec, seriesCand);
  assert.equal(scoredSeries.mediaTypeCompatible, false);
  assert.equal(scoredSeries.confidence, "none");

  const ranked = rankCandidates(movieSpec, [seriesCand, movieCand]);
  assert.equal(ranked.results.length, 1);
  assert.equal(ranked.topCandidate.imdbId, "tt2543164");
  assert.equal(ranked.confidence, "high");
});

test("alias registry enforces accurate media-type mappings and franchise-level ambiguity (LOTR, JJK, HxH)", () => {
  // Series anime aliases do NOT advertise movie entries unless a specific movie work is mapped
  assert.equal(lookupTitleAliases("Shingeki no Kyojin", "series")[0].canonicalTitle, "Attack on Titan");
  assert.equal(lookupTitleAliases("Shingeki no Kyojin", "movie").length, 0);
  assert.equal(lookupTitleAliases("jjk", "series")[0].canonicalTitle, "Jujutsu Kaisen");
  assert.equal(lookupTitleAliases("jjk", "movie").length, 0);
  assert.equal(lookupTitleAliases("jjk 0", "movie")[0].canonicalTitle, "Jujutsu Kaisen 0");
  assert.equal(lookupTitleAliases("jjk 0", "series").length, 0);
  assert.equal(lookupTitleAliases("kimetsu no yaiba", "series")[0].canonicalTitle, "Demon Slayer: Kimetsu no Yaiba");
  assert.equal(lookupTitleAliases("kimetsu no yaiba", "movie").length, 0);

  // Movie anime aliases stay movie-scoped
  assert.equal(lookupTitleAliases("Kimi no Na wa", "movie")[0].canonicalTitle, "Your Name.");
  assert.equal(lookupTitleAliases("Kimi no Na wa", "series").length, 0);

  // Short common English words must NOT exist as aliases
  for (const risky of ["got", "dark", "lost", "you", "it", "her", "up", "one", "saw"]) {
    assert.equal(lookupTitleAliases(risky, "series").length, 0);
    assert.equal(lookupTitleAliases(risky, "movie").length, 0);
  }

  // LOTR franchise alias MUST NOT auto-select a single film even when only 1 installment is returned
  const lotrSingle = rankCandidates("LOTR", [
    makeCandidate({ imdbId: "tt0167260", title: "The Lord of the Rings: The Return of the King", year: "2003", rating: "9.0", mediaType: "movie" })
  ], "movie");
  assert.equal(lotrSingle.ambiguous, true);
  assert.equal(lotrSingle.selectedCandidate, null);
  assert.equal(lotrSingle.confidence, "medium");
  assert.equal(lotrSingle.ranked[0].evidence.franchiseAmbiguous, true);

  const lotrTrilogy = rankCandidates("LOTR", [
    makeCandidate({ imdbId: "tt0120737", title: "The Lord of the Rings: The Fellowship of the Ring", year: "2001", rating: "8.9", mediaType: "movie" }),
    makeCandidate({ imdbId: "tt0167261", title: "The Lord of the Rings: The Two Towers", year: "2002", rating: "8.8", mediaType: "movie" }),
    makeCandidate({ imdbId: "tt0167260", title: "The Lord of the Rings: The Return of the King", year: "2003", rating: "9.0", mediaType: "movie" })
  ], "movie");
  assert.equal(lotrTrilogy.ambiguous, true);
  assert.equal(lotrTrilogy.selectedCandidate, null);
  assert.equal(lotrTrilogy.results.length, 3);

  // M3: Explicit-year franchise alias disambiguation works consistently ("LOTR 2001" vs trilogy)
  const lotr2001 = rankCandidates("LOTR 2001", [
    makeCandidate({ imdbId: "tt0120737", title: "The Lord of the Rings: The Fellowship of the Ring", year: "2001", rating: "8.9", mediaType: "movie" }),
    makeCandidate({ imdbId: "tt0167261", title: "The Lord of the Rings: The Two Towers", year: "2002", rating: "8.8", mediaType: "movie" }),
    makeCandidate({ imdbId: "tt0167260", title: "The Lord of the Rings: The Return of the King", year: "2003", rating: "9.0", mediaType: "movie" })
  ], "movie");
  assert.equal(lotr2001.ambiguous, false);
  assert.equal(lotr2001.confidence, "high");
  assert.equal(lotr2001.selectedCandidate.imdbId, "tt0120737");

  // H4: Overly broad "love is war" alias removed — unrelated show "Love Is War" is not hijacked by Kaguya-sama
  assert.equal(lookupTitleAliases("love is war", "series").length, 0);
  const loveIsWarOutcome = rankCandidates("love is war", [
    makeCandidate({ imdbId: "tt9522300", title: "Kaguya-sama: Love Is War", year: "2019", rating: "8.5", mediaType: "series" }),
    makeCandidate({ imdbId: "tt9009010", title: "Love Is War", year: "2018", rating: "6.8", mediaType: "series" })
  ], "series");
  assert.equal(loveIsWarOutcome.topCandidate.imdbId, "tt9009010");
  assert.equal(loveIsWarOutcome.selectedCandidate.imdbId, "tt9009010");

  // H4: IMDb ID alias match MUST fail title sanity check when candidate title contradicts canonical title
  // (including partial single-word overlaps and unanchored substring traps)
  const aliasConflictCases = [
    ["aot", "tt2560140", "Completely Unrelated Show"],
    ["aot", "tt2560140", "Attack of the Clones"],
    ["csm", "tt13616990", "Spider-Man"],
    ["opm", "tt4508902", "Iron Man"],
    ["mha", "tt5626028", "Last Action Hero"],
    ["boku dake ga inai machi", "tt5249462", "Unerased"],
    ["jigeum uri hakgyoneun", "tt14169960", "The Walking Dead"]
  ];
  for (const [aliasQuery, aliasImdbId, badTitle] of aliasConflictCases) {
    const conflictOutcome = rankCandidates(aliasQuery, [
      makeCandidate({ imdbId: aliasImdbId, title: badTitle, year: "2020", mediaType: "series" })
    ], "series");
    assert.equal(conflictOutcome.ranked[0].evidence.aliasTitleConflict, true, `Expected aliasTitleConflict for "${aliasQuery}" vs "${badTitle}"`);
    assert.equal(conflictOutcome.ranked[0].evidence.matchType, "alias-title-conflict");
    assert.equal(conflictOutcome.confidence, "low");
    assert.equal(conflictOutcome.selectedCandidate, null);
    assert.equal(conflictOutcome.needsFallback, true);
    assert.equal(getKnownAliasesForCandidate({ imdbId: aliasImdbId, title: badTitle }, "series").length, 0);
  }

  // HxH without year is franchise-ambiguous (1999 vs 2011); with year 2011 disambiguates cleanly
  const hxhCandidates = [
    makeCandidate({ imdbId: "tt0426719", title: "Hunter x Hunter", year: "1999", rating: "8.5", mediaType: "series" }),
    makeCandidate({ imdbId: "tt2098220", title: "Hunter x Hunter", year: "2011", rating: "9.0", mediaType: "series" })
  ];
  const hxhNoYear = rankCandidates("HxH", hxhCandidates, "series");
  assert.equal(hxhNoYear.ambiguous, true);
  assert.equal(hxhNoYear.selectedCandidate, null);
  assert.equal(hxhNoYear.confidence, "medium");

  const hxh2011 = rankCandidates("HxH 2011", hxhCandidates, "series");
  assert.equal(hxh2011.ambiguous, false);
  assert.equal(hxh2011.topCandidate.imdbId, "tt2098220");
  assert.equal(hxh2011.confidence, "high");

  const known = getKnownAliasesForCandidate({ imdbId: "tt2560140", title: "Attack on Titan" }, "series");
  assert.equal(known.length, 1);
  assert.ok(TITLE_ALIAS_ENTRIES.length >= 40);
});

test("deduplicateCandidates is placeholder-aware, never merges conflicting media types, and keeps results clean", () => {
  // Placeholder title ("Unknown title") and generic display type ("Series") first -> richer second record wins
  const mergedPlaceholder = deduplicateCandidates([
    { id: "tt0903747", title: "Unknown title", year: null, poster: null, rating: null, type: "Series", genres: [], mediaType: "series" },
    { id: "tt0903747", title: "Breaking Bad", year: "2008-2013", poster: "https://img/bb.jpg", rating: "9.5", type: "Crime · Drama", genres: ["Crime", "Drama"], synopsis: "A chemistry teacher...", mediaType: "series" }
  ], "series");
  assert.equal(mergedPlaceholder.length, 1);
  assert.equal(mergedPlaceholder[0].title, "Breaking Bad");
  assert.equal(mergedPlaceholder[0].type, "Crime · Drama");
  assert.equal(mergedPlaceholder[0].year, "2008-2013");
  assert.equal(mergedPlaceholder[0].poster, "https://img/bb.jpg");
  assert.equal(mergedPlaceholder[0].rating, "9.5");
  assert.equal(Object.hasOwn(mergedPlaceholder[0], "alternateTitles"), false);
  assert.equal(Object.hasOwn(mergedPlaceholder[0], "score"), false);

  // Conflicting movie + series records with same IMDb ID MUST NOT be merged when mediaType is omitted
  const conflicting = deduplicateCandidates([
    { id: "tt1234567", title: "Example Film", year: "2020", mediaType: "movie" },
    { id: "tt1234567", title: "Example Series", year: "2021", mediaType: "series" }
  ]);
  assert.equal(conflicting.length, 2);
  assert.deepEqual(new Set(conflicting.map(item => item.mediaType)), new Set(["movie", "series"]));

  // M4: Conflicting non-placeholder titles or conflicting valid years (>= 2 years apart) on same IMDb ID stay separate
  const conflictingTitles = deduplicateCandidates([
    { id: "tt0903747", title: "Breaking Bad", year: "2008", mediaType: "series" },
    { id: "tt0903747", title: "El Camino", year: "2019", mediaType: "series" }
  ], "series");
  assert.equal(conflictingTitles.length, 2);
  assert.deepEqual(conflictingTitles.map(c => c.title), ["Breaking Bad", "El Camino"]);

  const conflictingYears = deduplicateCandidates([
    { id: "tt1160419", title: "Dune", year: "1984", mediaType: "movie" },
    { id: "tt1160419", title: "Dune", year: "2021", mediaType: "movie" }
  ], "movie");
  assert.equal(conflictingYears.length, 2);

  // M4: Merging raw + normalized in BOTH orders cleans redundant raw synonyms (name, description, imdbRating) and never invents absent keys
  const normalizedFirstMerge = deduplicateCandidates([
    { id: "tt0903747", title: "Breaking Bad", synopsis: "Normalized synopsis.", rating: "9.4", mediaType: "series" },
    { id: "tt0903747", name: "Breaking Bad", description: "Longer raw description from Cinemeta.", imdbRating: "9.5", poster: "https://img/bb.jpg" }
  ], "series");
  assert.equal(normalizedFirstMerge.length, 1);
  assert.equal(normalizedFirstMerge[0].title, "Breaking Bad");
  assert.equal(normalizedFirstMerge[0].synopsis, "Longer raw description from Cinemeta.");
  assert.equal(normalizedFirstMerge[0].rating, "9.4");
  assert.equal(normalizedFirstMerge[0].poster, "https://img/bb.jpg");
  assert.equal(Object.hasOwn(normalizedFirstMerge[0], "name"), false);
  assert.equal(Object.hasOwn(normalizedFirstMerge[0], "description"), false);
  assert.equal(Object.hasOwn(normalizedFirstMerge[0], "imdbRating"), false);
  assert.equal(Object.hasOwn(normalizedFirstMerge[0], "year"), false);
  assert.equal(Object.hasOwn(normalizedFirstMerge[0], "genres"), false);

  const rawFirstMerge = deduplicateCandidates([
    { id: "tt0903747", name: "Breaking Bad", description: "Short raw desc.", imdbRating: "9.5", poster: "https://img/bb.jpg" },
    { id: "tt0903747", title: "Breaking Bad", synopsis: "Longer normalized synopsis text.", rating: "9.5", mediaType: "series" }
  ], "series");
  assert.equal(rawFirstMerge.length, 1);
  assert.equal(rawFirstMerge[0].title, "Breaking Bad");
  assert.equal(rawFirstMerge[0].synopsis, "Longer normalized synopsis text.");
  assert.equal(rawFirstMerge[0].rating, "9.5");
  assert.equal(rawFirstMerge[0].poster, "https://img/bb.jpg");
  assert.equal(rawFirstMerge[0].mediaType, "series");
  assert.equal(Object.hasOwn(rawFirstMerge[0], "name"), false);
  assert.equal(Object.hasOwn(rawFirstMerge[0], "description"), false);
  assert.equal(Object.hasOwn(rawFirstMerge[0], "imdbRating"), false);
  assert.equal(Object.hasOwn(rawFirstMerge[0], "year"), false);
  assert.equal(Object.hasOwn(rawFirstMerge[0], "genres"), false);
  assert.equal(parseCandidateYear("2008-2013"), 2008);
});

test("typo safety blocks stopword-assisted & <=7-char single-significant-token traps while preserving real typos (H1)", () => {
  // Adversarial single-significant-token traps (5-7 chars, with and without stopwords) MUST NOT reach medium or high
  const singleWordTraps = [
    ["castle", "Cattle"],
    ["prison", "Poison"],
    ["mental", "Rental"],
    ["planet", "Plants"],
    ["silver", "Sliver"],
    ["the castle", "The Cattle"],
    ["the prison", "The Poison"],
    ["chapter", "Charter"],
    ["monster", "Mobster"],
    ["martial", "Marital"]
  ];
  for (const [query, candTitle] of singleWordTraps) {
    const outcome = rankCandidates(query, [makeCandidate({ title: candTitle, mediaType: "movie" })], "movie");
    assert.ok(
      outcome.confidence === "low" || outcome.confidence === "none",
      `Typo trap "${query}" vs "${candTitle}" must stay low/none, got ${outcome.confidence} (${outcome.topScore})`
    );
    assert.equal(outcome.selectedCandidate, null);
    assert.equal(outcome.needsFallback, true);
  }

  // Genuine longer typos (len >= 8) and multi-significant-token anchored typos are tolerated at medium (never high)
  const breakingBad = makeCandidate({ imdbId: "tt0903747", title: "Breaking Bad", year: "2008", rating: "9.5" });
  const severance = makeCandidate({ imdbId: "tt11280740", title: "Severance", year: "2022", rating: "8.7" });
  const inception = makeCandidate({ imdbId: "tt1375666", title: "Inception", year: "2010", rating: "8.8", mediaType: "movie" });
  const demonSlayer = makeCandidate({ imdbId: "tt9335498", title: "Demon Slayer: Kimetsu no Yaiba", year: "2019", rating: "8.6" });

  for (const [q, cand, mt] of [
    ["breking bad", breakingBad, "series"],
    ["sevrance", severance, "series"],
    ["incepiton", inception, "movie"],
    ["Demon Slyer", demonSlayer, "series"],
    ["breakingbad", breakingBad, "series"]
  ]) {
    const ev = scoreCandidate(q, cand, mt);
    assert.equal(ev.confidence, "medium", `Expected medium for "${q}" vs "${cand.title}", got ${ev.confidence}`);
    assert.equal(ev.typoOnlyCapped, true);
    assert.ok(ev.score >= 0.62 && ev.score <= 0.79);
  }

  assert.equal(damerauLevenshtein("silver", "sliver"), 1);
});

test("short-title safeguards apply to leading-article variants and partial prefixes remain ambiguous", () => {
  // Short-title leading-article variant: "Bear" vs "The Bear" stays capped at medium (never high without year)
  const theBear = makeCandidate({ imdbId: "tt14452776", title: "The Bear", year: "2022", rating: "8.5" });
  const bearOnly = rankCandidates("Bear", [theBear], "series");
  assert.equal(bearOnly.confidence, "medium");
  assert.equal(bearOnly.selectedCandidate, null);
  assert.equal(bearOnly.ranked[0].evidence.shortTitleGuardApplied, true);

  // Exact "The Bear" reaches high
  const exactBear = rankCandidates("The Bear", [theBear], "series");
  assert.equal(exactBear.confidence, "high");
  assert.equal(exactBear.selectedCandidate.imdbId, "tt14452776");

  // Ambiguous partial prefix: "Breaking" against "Breaking Bad" and "Breaking In"
  const breakingAmbiguous = rankCandidates("Breaking", [
    makeCandidate({ imdbId: "tt0903747", title: "Breaking Bad", year: "2008", rating: "9.5" }),
    makeCandidate({ imdbId: "tt1630574", title: "Breaking In", year: "2011", rating: "7.0" })
  ], "series");
  assert.equal(breakingAmbiguous.ambiguous, true);
  assert.equal(breakingAmbiguous.selectedCandidate, null);
  assert.equal(breakingAmbiguous.results.length, 2);

  // Short-title 4-char typo guard ("Dark" / "Park" / "Bark") + exact-year disambiguation
  const darkSet = [
    makeCandidate({ imdbId: "tt5753856", title: "Dark", year: "2017", rating: "8.7" }),
    makeCandidate({ imdbId: "tt19231492", title: "Dark Matter", year: "2024", rating: "7.7" }),
    makeCandidate({ imdbId: "tt9990001", title: "Park", year: "2020", rating: "7.1" })
  ];
  const darkNoYear = rankCandidates("Dark", darkSet, "series");
  assert.equal(darkNoYear.ambiguous, true);
  assert.equal(darkNoYear.confidence, "medium");
  assert.equal(darkNoYear.ranked[0].evidence.confidence, "medium"); // internally consistent with outcome.confidence
  assert.equal(darkNoYear.ranked[0].evidence.ambiguityDowngraded, true);
  assert.equal(darkNoYear.selectedCandidate, null);

  const dark2017 = rankCandidates("Dark 2017", darkSet, "series");
  assert.equal(dark2017.ambiguous, false);
  assert.equal(dark2017.confidence, "high");
  assert.equal(dark2017.topCandidate.imdbId, "tt5753856");
});

test("remake disambiguation, substantial year mismatch low-confidence handling, and unknown-year stub handling", () => {
  const dune1984 = makeCandidate({ imdbId: "tt0087182", title: "Dune", year: "1984", rating: "6.3", mediaType: "movie" });
  const dune2021 = makeCandidate({ imdbId: "tt1160419", title: "Dune", year: "2021", rating: "8.0", mediaType: "movie" });
  const duneUnknownYear = makeCandidate({ imdbId: "tt9998887", title: "Dune", year: null, rating: null, poster: null, mediaType: "movie" });

  // No year -> ambiguous, both remakes preserved, top evidence confidence synced to medium
  const noYear = rankCandidates("Dune", [dune1984, dune2021], "movie");
  assert.equal(noYear.ambiguous, true);
  assert.equal(noYear.confidence, "medium");
  assert.equal(noYear.ranked[0].evidence.confidence, "medium");
  assert.equal(noYear.selectedCandidate, null);
  assert.equal(noYear.results.length, 2);

  // Dune 2021 when BOTH exist -> exact year wins at high confidence
  const with2021 = rankCandidates("Dune 2021", [dune1984, dune2021], "movie");
  assert.equal(with2021.ambiguous, false);
  assert.equal(with2021.confidence, "high");
  assert.equal(with2021.topCandidate.imdbId, "tt1160419");

  // Dune 2021 alongside an unknown-year stub -> exact year still wins without false ambiguity
  const withStub = rankCandidates("Dune 2021", [duneUnknownYear, dune2021], "movie");
  assert.equal(withStub.ambiguous, false);
  assert.equal(withStub.confidence, "high");
  assert.equal(withStub.topCandidate.imdbId, "tt1160419");

  // CRITICAL: Dune 2021 when ONLY the 1984 candidate exists -> preserved in results,
  // but substantial year mismatch MUST produce low confidence + needsFallback=true + no auto-selection!
  const mismatchOnly = rankCandidates("Dune 2021", [dune1984], "movie");
  assert.equal(mismatchOnly.results.length, 1);
  assert.equal(mismatchOnly.topCandidate.imdbId, "tt0087182");
  assert.equal(mismatchOnly.ranked[0].evidence.yearCompatibility, "mismatch");
  assert.equal(mismatchOnly.confidence, "low");
  assert.equal(mismatchOnly.needsFallback, true);
  assert.equal(mismatchOnly.selectedCandidate, null);
});

test("unverified alternateTitles never auto-select and missing mediaType never qualifies for high confidence (H2, H3)", () => {
  // H2: Explicitly verifiedAlternateTitles can reach high confidence
  const withVerifiedAlt = makeCandidate({
    imdbId: "tt0807832",
    title: "Mushi-Shi",
    verifiedAlternateTitles: ["Mushishi"],
    year: "2005",
    mediaType: "series"
  });
  const verifiedOutcome = rankCandidates("Mushishi", [withVerifiedAlt], "series");
  assert.equal(verifiedOutcome.confidence, "high");
  assert.equal(verifiedOutcome.selectedCandidate.imdbId, "tt0807832");
  assert.equal(verifiedOutcome.ranked[0].evidence.alternateTitleVerified, true);

  // H2: Unverified upstream alternateTitles with primary alignment stay capped at medium (selectedCandidate=null)
  const withUnverifiedAlt = makeCandidate({
    imdbId: "tt0807832",
    title: "Mushi-Shi",
    alternateTitles: ["Mushishi"],
    year: "2005",
    mediaType: "series"
  });
  const unverifiedOutcome = rankCandidates("Mushishi", [withUnverifiedAlt], "series");
  assert.equal(unverifiedOutcome.confidence, "medium");
  assert.equal(unverifiedOutcome.selectedCandidate, null);
  assert.equal(unverifiedOutcome.ranked[0].evidence.unverifiedAlternateTitleMatch, true);
  assert.equal(unverifiedOutcome.ranked[0].evidence.alternateTitleVerified, false);

  // H2: Spoofed unverified alternateTitles / originalTitle / aliases / aka on unrelated primary title MUST stay low & never auto-select
  for (const field of ["alternateTitles", "aliases", "aka", "originalTitle", "originalName"]) {
    const spoofed = makeCandidate({
      imdbId: "tt9999999",
      title: "Random Spam Video",
      [field]: field.startsWith("original") ? "Breaking Bad" : ["Breaking Bad"],
      year: "2020",
      mediaType: "series"
    });
    const spoofOutcome = rankCandidates("Breaking Bad", [spoofed], "series");
    assert.equal(spoofOutcome.confidence, "low", `Spoofed ${field} must stay low, got ${spoofOutcome.confidence}`);
    assert.equal(spoofOutcome.selectedCandidate, null, `Spoofed ${field} must never auto-select`);
    assert.equal(spoofOutcome.needsFallback, true);
  }

  const withoutAlt = makeCandidate({
    imdbId: "tt0807832",
    title: "Bug Master",
    year: "2005",
    mediaType: "series"
  });
  assert.equal(scoreCandidate("Mushishi", withoutAlt, "series").confidence, "none");

  // H3: Missing mediaType (even with a genre display string in `type`) -> mediaTypeStatus="unknown", NEVER high / selectedCandidate
  const missingMediaType = {
    id: "tt0903747",
    imdbId: "tt0903747",
    title: "Breaking Bad",
    year: "2008",
    rating: "9.5",
    type: "Crime · Drama",
    poster: "https://images.test/poster.jpg"
  };
  const unknownTypeOutcome = rankCandidates("Breaking Bad", [missingMediaType], "series");
  assert.equal(unknownTypeOutcome.ranked[0].evidence.mediaTypeStatus, "unknown");
  assert.equal(unknownTypeOutcome.ranked[0].evidence.mediaTypeVerified, false);
  assert.equal(unknownTypeOutcome.confidence, "medium");
  assert.equal(unknownTypeOutcome.selectedCandidate, null);

  // H3: Even direct IMDb lookup with missing mediaType cannot auto-select at high
  const unknownDirectImdb = rankCandidates("tt0903747", [missingMediaType], "series");
  assert.equal(unknownDirectImdb.ranked[0].evidence.mediaTypeStatus, "unknown");
  assert.equal(unknownDirectImdb.confidence, "medium");
  assert.equal(unknownDirectImdb.selectedCandidate, null);

  // H3: Valid, genuinely-absent raw `type`, empty, and explicitly invalid mediaType handling
  const rawAbsentMediaType = { id: "tt0903747", title: "Breaking Bad", year: "2008", type: "series" };
  const rawValidOutcome = rankCandidates("Breaking Bad", [rawAbsentMediaType], "series");
  assert.equal(rawValidOutcome.ranked[0].evidence.mediaTypeStatus, "match");
  assert.equal(rawValidOutcome.confidence, "high");
  assert.equal(rawValidOutcome.selectedCandidate.imdbId, "tt0903747");

  for (const badMediaType of ["", "   ", "invalid", "anime", "SERIES"]) {
    const badCand = {
      id: "tt0903747",
      title: "Breaking Bad",
      year: "2008",
      rating: "9.5",
      mediaType: badMediaType,
      type: "series" // MUST NOT silently fall back to `type` when `mediaType` is explicitly present and invalid/empty
    };
    const badOutcome = rankCandidates("Breaking Bad", [badCand], "series");
    assert.equal(badOutcome.ranked[0].evidence.mediaTypeStatus, "unknown", `Expected unknown for mediaType=${JSON.stringify(badMediaType)}`);
    assert.equal(badOutcome.ranked[0].evidence.mediaTypeVerified, false);
    assert.equal(badOutcome.confidence, "medium");
    assert.equal(badOutcome.selectedCandidate, null);
  }
});

test("BENCHMARK (synthetic mocked catalog): categorized accuracy, ambiguity detection, and adversarial false-positive rates", () => {
  const positiveCases = [
    // Exact matches
    {
      category: "exact",
      label: "Breaking Bad (series)",
      query: "Breaking Bad",
      mediaType: "series",
      expectedId: "tt0903747",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt9000001", title: "Breaking Bad: The Documentary", year: "2013" }),
        makeCandidate({ imdbId: "tt0903747", title: "Breaking Bad", year: "2008-2013", rating: "9.5" }),
        makeCandidate({ imdbId: "tt3032476", title: "Better Call Saul", year: "2015-2022", rating: "9.0" })
      ]
    },
    {
      category: "exact",
      label: "Arrival (movie)",
      query: "Arrival",
      mediaType: "movie",
      expectedId: "tt2543164",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt9000002", title: "The Arrival of a Train", year: "1896", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt2543164", title: "Arrival", year: "2016", rating: "7.9", mediaType: "movie" })
      ]
    },
    {
      category: "exact",
      label: "Amelie diacritic (movie)",
      query: "Amelie",
      mediaType: "movie",
      expectedId: "tt0211915",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt0211915", title: "Amélie", year: "2001", rating: "8.3", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt9000003", title: "Amelia", year: "2009", rating: "5.8", mediaType: "movie" })
      ]
    },
    {
      category: "exact",
      label: "The.Bear S02 1080p noise strip",
      query: "The.Bear S02 1080p",
      mediaType: "series",
      expectedId: "tt14452776",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt14452776", title: "The Bear", year: "2022", rating: "8.5" }),
        makeCandidate({ imdbId: "tt9000004", title: "Bear in the Big Blue House", year: "1997" })
      ]
    },
    {
      category: "exact",
      label: "Direct IMDb ID tt11280740",
      query: "tt11280740",
      mediaType: "series",
      expectedId: "tt11280740",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt11280740", title: "Severance", year: "2022", rating: "8.7" })
      ]
    },

    // Aliases
    {
      category: "aliases",
      label: "Shingeki no Kyojin -> Attack on Titan",
      query: "Shingeki no Kyojin",
      mediaType: "series",
      expectedId: "tt2560140",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt2560140", title: "Attack on Titan", year: "2013-2023", rating: "9.1" }),
        makeCandidate({ imdbId: "tt9000005", title: "Attack on Titan: Junior High", year: "2015", rating: "7.2" })
      ]
    },
    {
      category: "aliases",
      label: "Kimetsu no Yaiba -> Demon Slayer",
      query: "Kimetsu no Yaiba",
      mediaType: "series",
      expectedId: "tt9335498",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt9335498", title: "Demon Slayer: Kimetsu no Yaiba", year: "2019", rating: "8.6" })
      ]
    },
    {
      category: "aliases",
      label: "FMAB -> Fullmetal Alchemist: Brotherhood",
      query: "FMAB",
      mediaType: "series",
      expectedId: "tt1355642",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt0421357", title: "Fullmetal Alchemist", year: "2003", rating: "8.5" }),
        makeCandidate({ imdbId: "tt1355642", title: "Fullmetal Alchemist: Brotherhood", year: "2009", rating: "9.1" })
      ]
    },
    {
      category: "aliases",
      label: "Sousou no Frieren -> Frieren",
      query: "Sousou no Frieren",
      mediaType: "series",
      expectedId: "tt22248376",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt22248376", title: "Frieren: Beyond Journey's End", year: "2023", rating: "8.9" })
      ]
    },
    {
      category: "aliases",
      label: "Kimi no Na wa -> Your Name. (movie)",
      query: "Kimi no Na wa",
      mediaType: "movie",
      expectedId: "tt5311514",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt5311514", title: "Your Name.", year: "2016", rating: "8.4", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt9000006", title: "Call Me by Your Name", year: "2017", rating: "7.8", mediaType: "movie" })
      ]
    },
    {
      category: "aliases",
      label: "JJK 0 -> Jujutsu Kaisen 0 (movie)",
      query: "JJK 0",
      mediaType: "movie",
      expectedId: "tt14331144",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt14331144", title: "Jujutsu Kaisen 0", year: "2021", rating: "7.8", mediaType: "movie" })
      ]
    },
    {
      category: "aliases",
      label: "La Casa de Papel -> Money Heist",
      query: "La Casa de Papel",
      mediaType: "series",
      expectedId: "tt6468322",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt6468322", title: "Money Heist", year: "2017-2021", rating: "8.2" })
      ]
    },

    // Typos (must be medium, never high)
    {
      category: "typos",
      label: "breking bad -> Breaking Bad",
      query: "breking bad",
      mediaType: "series",
      expectedId: "tt0903747",
      expectedConfidence: "medium",
      candidates: [
        makeCandidate({ imdbId: "tt0903747", title: "Breaking Bad", year: "2008", rating: "9.5" }),
        makeCandidate({ imdbId: "tt9000007", title: "Breaking In", year: "2011", rating: "7.0" })
      ]
    },
    {
      category: "typos",
      label: "incepiton -> Inception",
      query: "incepiton",
      mediaType: "movie",
      expectedId: "tt1375666",
      expectedConfidence: "medium",
      candidates: [
        makeCandidate({ imdbId: "tt1375666", title: "Inception", year: "2010", rating: "8.8", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt9000008", title: "Deception", year: "2008", rating: "6.0", mediaType: "movie" })
      ]
    },
    {
      category: "typos",
      label: "sevrance -> Severance",
      query: "sevrance",
      mediaType: "series",
      expectedId: "tt11280740",
      expectedConfidence: "medium",
      candidates: [
        makeCandidate({ imdbId: "tt11280740", title: "Severance", year: "2022", rating: "8.7" })
      ]
    },
    {
      category: "typos",
      label: "demon slyer -> Demon Slayer: Kimetsu no Yaiba",
      query: "demon slyer",
      mediaType: "series",
      expectedId: "tt9335498",
      expectedConfidence: "medium",
      candidates: [
        makeCandidate({ imdbId: "tt9335498", title: "Demon Slayer: Kimetsu no Yaiba", year: "2019", rating: "8.6" }),
        makeCandidate({ imdbId: "tt9000011", title: "Demon King", year: "2015", rating: "6.2" })
      ]
    },

    // Numeric titles (years/numbers genuinely part of title)
    {
      category: "numeric-titles",
      label: "Wonder Woman 1984 (2020)",
      query: "Wonder Woman 1984",
      mediaType: "movie",
      expectedId: "tt7126948",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt0451279", title: "Wonder Woman", year: "2017", rating: "7.4", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt7126948", title: "Wonder Woman 1984", year: "2020", rating: "5.4", mediaType: "movie" })
      ]
    },
    {
      category: "numeric-titles",
      label: "Death Race 2000 (1975)",
      query: "Death Race 2000",
      mediaType: "movie",
      expectedId: "tt0072856",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt0452608", title: "Death Race", year: "2008", rating: "6.4", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt0072856", title: "Death Race 2000", year: "1975", rating: "6.2", mediaType: "movie" })
      ]
    },
    {
      category: "numeric-titles",
      label: "Space: 1999 (1975)",
      query: "Space: 1999",
      mediaType: "series",
      expectedId: "tt0072564",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt0072564", title: "Space: 1999", year: "1975-1977", rating: "7.3" })
      ]
    },
    {
      category: "numeric-titles",
      label: "Star Wars: Episode 4 -> Episode IV",
      query: "Star Wars: Episode 4",
      mediaType: "movie",
      expectedId: "tt0076759",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt0076759", title: "Star Wars: Episode IV", year: "1977", rating: "8.6", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt0120915", title: "Star Wars: Episode I", year: "1999", rating: "6.5", mediaType: "movie" })
      ]
    },
    {
      category: "numeric-titles",
      label: "2 Fast 2 Furious & District 9",
      query: "District 9",
      mediaType: "movie",
      expectedId: "tt1136608",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt1136608", title: "District 9", year: "2009", rating: "7.9", mediaType: "movie" })
      ]
    },

    // Remakes disambiguated by year
    {
      category: "remakes",
      label: "Dune 2021 vs 1984",
      query: "Dune 2021",
      mediaType: "movie",
      expectedId: "tt1160419",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt0087182", title: "Dune", year: "1984", rating: "6.3", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt1160419", title: "Dune", year: "2021", rating: "8.0", mediaType: "movie" })
      ]
    },
    {
      category: "remakes",
      label: "The Office 2001 vs 2005",
      query: "The Office 2001",
      mediaType: "series",
      expectedId: "tt0290978",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt0290978", title: "The Office", year: "2001-2003", rating: "8.5" }),
        makeCandidate({ imdbId: "tt0386676", title: "The Office", year: "2005-2013", rating: "9.0" })
      ]
    },
    {
      category: "remakes",
      label: "HxH 2011 vs 1999",
      query: "HxH 2011",
      mediaType: "series",
      expectedId: "tt2098220",
      expectedConfidence: "high",
      candidates: [
        makeCandidate({ imdbId: "tt0426719", title: "Hunter x Hunter", year: "1999", rating: "8.5" }),
        makeCandidate({ imdbId: "tt2098220", title: "Hunter x Hunter", year: "2011", rating: "9.0" })
      ]
    }
  ];

  // Ambiguous & franchise queries (MUST be detected as ambiguous and NEVER auto-selected)
  const ambiguousCases = [
    {
      category: "remakes",
      label: "Dune without year",
      query: "Dune",
      mediaType: "movie",
      candidates: [
        makeCandidate({ imdbId: "tt0087182", title: "Dune", year: "1984", rating: "6.3", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt1160419", title: "Dune", year: "2021", rating: "8.0", mediaType: "movie" })
      ]
    },
    {
      category: "remakes",
      label: "The Office without year",
      query: "The Office",
      mediaType: "series",
      candidates: [
        makeCandidate({ imdbId: "tt0290978", title: "The Office", year: "2001-2003", rating: "8.5" }),
        makeCandidate({ imdbId: "tt0386676", title: "The Office", year: "2005-2013", rating: "9.0" })
      ]
    },
    {
      category: "franchises",
      label: "LOTR trilogy",
      query: "LOTR",
      mediaType: "movie",
      candidates: [
        makeCandidate({ imdbId: "tt0120737", title: "The Lord of the Rings: The Fellowship of the Ring", year: "2001", rating: "8.9", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt0167261", title: "The Lord of the Rings: The Two Towers", year: "2002", rating: "8.8", mediaType: "movie" }),
        makeCandidate({ imdbId: "tt0167260", title: "The Lord of the Rings: The Return of the King", year: "2003", rating: "9.0", mediaType: "movie" })
      ]
    },
    {
      category: "franchises",
      label: "LOTR single installment returned",
      query: "LOTR",
      mediaType: "movie",
      candidates: [
        makeCandidate({ imdbId: "tt0167260", title: "The Lord of the Rings: The Return of the King", year: "2003", rating: "9.0", mediaType: "movie" })
      ]
    },
    {
      category: "franchises",
      label: "HxH without year",
      query: "HxH",
      mediaType: "series",
      candidates: [
        makeCandidate({ imdbId: "tt0426719", title: "Hunter x Hunter", year: "1999", rating: "8.5" }),
        makeCandidate({ imdbId: "tt2098220", title: "Hunter x Hunter", year: "2011", rating: "9.0" })
      ]
    },
    {
      category: "exact",
      label: "Breaking ambiguous prefix",
      query: "Breaking",
      mediaType: "series",
      candidates: [
        makeCandidate({ imdbId: "tt0903747", title: "Breaking Bad", year: "2008", rating: "9.5" }),
        makeCandidate({ imdbId: "tt1630574", title: "Breaking In", year: "2011", rating: "7.0" })
      ]
    }
  ];

  // Adversarial negative / false-positive traps (MUST stay low or none, selectedCandidate=null)
  const adversarialTraps = [
    { label: "castle vs cattle", query: "castle", mediaType: "movie", candidates: [makeCandidate({ title: "Cattle", mediaType: "movie" })] },
    { label: "prison vs poison", query: "prison", mediaType: "movie", candidates: [makeCandidate({ title: "Poison", mediaType: "movie" })] },
    { label: "mental vs rental", query: "mental", mediaType: "movie", candidates: [makeCandidate({ title: "Rental", mediaType: "movie" })] },
    { label: "planet vs plants", query: "planet", mediaType: "movie", candidates: [makeCandidate({ title: "Plants", mediaType: "movie" })] },
    { label: "silver vs sliver", query: "silver", mediaType: "movie", candidates: [makeCandidate({ title: "Sliver", mediaType: "movie" })] },
    { label: "the castle vs The Cattle (H1)", query: "the castle", mediaType: "movie", candidates: [makeCandidate({ title: "The Cattle", mediaType: "movie" })] },
    { label: "the prison vs The Poison (H1)", query: "the prison", mediaType: "movie", candidates: [makeCandidate({ title: "The Poison", mediaType: "movie" })] },
    { label: "chapter vs Charter (H1)", query: "chapter", mediaType: "movie", candidates: [makeCandidate({ title: "Charter", mediaType: "movie" })] },
    { label: "monster vs Mobster (H1)", query: "monster", mediaType: "movie", candidates: [makeCandidate({ title: "Mobster", mediaType: "movie" })] },
    { label: "martial vs Marital (H1)", query: "martial", mediaType: "movie", candidates: [makeCandidate({ title: "Marital", mediaType: "movie" })] },
    { label: "spoofed alternateTitles Breaking Bad (H2)", query: "Breaking Bad", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt9999999", title: "Random Spam Video", alternateTitles: ["Breaking Bad"] })] },
    { label: "aot IMDb ID title conflict (H4)", query: "aot", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt2560140", title: "Completely Unrelated Show" })] },
    { label: "aot vs Attack of the Clones (H4)", query: "aot", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt2560140", title: "Attack of the Clones" })] },
    { label: "csm vs Spider-Man (H4)", query: "csm", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt13616990", title: "Spider-Man" })] },
    { label: "opm vs Iron Man (H4)", query: "opm", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt4508902", title: "Iron Man" })] },
    { label: "mha vs Last Action Hero (H4)", query: "mha", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt5626028", title: "Last Action Hero" })] },
    { label: "erased alias vs Unerased (H4)", query: "boku dake ga inai machi", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt5249462", title: "Unerased" })] },
    { label: "all-of-us-are-dead alias vs The Walking Dead (H4)", query: "jigeum uri hakgyoneun", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt14169960", title: "The Walking Dead" })] },
    { label: "VI vs 6", query: "VI", mediaType: "movie", candidates: [makeCandidate({ title: "6", mediaType: "movie" })] },
    { label: "IX vs 9", query: "IX", mediaType: "movie", candidates: [makeCandidate({ title: "9", year: "2009", mediaType: "movie" })] },
    { label: "IV vs 4", query: "IV", mediaType: "movie", candidates: [makeCandidate({ title: "4", mediaType: "movie" })] },
    { label: "baking dad vs Breaking Bad", query: "baking dad", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt0903747", title: "Breaking Bad", year: "2008" })] },
    { label: "Park vs Dark", query: "Park", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt5753856", title: "Dark", year: "2017" })] },
    { label: "Last vs Lost", query: "Last", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt0411008", title: "Lost", year: "2004" })] },
    { label: "The Matrix vs The Bear (stopword only)", query: "The Matrix", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt14452776", title: "The Bear", year: "2022" })] },
    { label: "Sergeant vs Severance", query: "Sergeant", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt11280740", title: "Severance", year: "2022" })] },
    { label: "Inception movie in series mode", query: "Inception", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt1375666", title: "Inception", mediaType: "movie" })] },
    { label: "JJK movie-mode series bleed", query: "JJK", mediaType: "movie", candidates: [makeCandidate({ imdbId: "tt12343534", title: "Jujutsu Kaisen", mediaType: "movie" })] },
    { label: "Kimi no Na wa in series mode", query: "Kimi no Na wa", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt5311514", title: "Your Name.", mediaType: "series" })] },
    { label: "Dune 2021 when only 1984 exists", query: "Dune 2021", mediaType: "movie", candidates: [makeCandidate({ imdbId: "tt0087182", title: "Dune", year: "1984", mediaType: "movie" })] },
    { label: "Japanese script 進撃の巨人", query: "進撃の巨人", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt2560140", title: "Attack on Titan" })] },
    { label: "Korean script 오징어 게임", query: "오징어 게임", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt10919420", title: "Squid Game" })] },
    { label: "Gibberish zxqwkjhgf", query: "zxqwkjhgf", mediaType: "series", candidates: [makeCandidate({ imdbId: "tt0903747", title: "Breaking Bad" })] }
  ];

  const byCategory = {};
  const recordCat = (cat, key) => {
    if (!byCategory[cat]) byCategory[cat] = { total: 0, top1: 0, top3: 0, ambiguousTotal: 0, ambiguousDetected: 0 };
    byCategory[cat][key] += 1;
  };

  let top1Hits = 0;
  let top3Hits = 0;
  for (const item of positiveCases) {
    recordCat(item.category, "total");
    const outcome = rankCandidates(item.query, item.candidates, item.mediaType);
    const ids = outcome.results.map(r => r.imdbId);
    if (ids[0] === item.expectedId) {
      top1Hits += 1;
      recordCat(item.category, "top1");
    }
    if (ids.slice(0, 3).includes(item.expectedId)) {
      top3Hits += 1;
      recordCat(item.category, "top3");
    }
    assert.equal(ids[0], item.expectedId, `[${item.category}:${item.label}] expected top-1 ${item.expectedId}, got ${ids[0]}`);
    assert.equal(outcome.confidence, item.expectedConfidence, `[${item.category}:${item.label}] expected ${item.expectedConfidence}, got ${outcome.confidence}`);
  }

  let ambiguousDetected = 0;
  let falseAutoSelectOnAmbiguous = 0;
  for (const item of ambiguousCases) {
    recordCat(item.category, "ambiguousTotal");
    const outcome = rankCandidates(item.query, item.candidates, item.mediaType);
    if (outcome.ambiguous) {
      ambiguousDetected += 1;
      recordCat(item.category, "ambiguousDetected");
    }
    if (outcome.selectedCandidate !== null) falseAutoSelectOnAmbiguous += 1;
    assert.equal(outcome.ambiguous, true, `[AMBIGUOUS:${item.label}] expected ambiguous=true`);
    assert.equal(outcome.selectedCandidate, null, `[AMBIGUOUS:${item.label}] must not auto-select`);
    assert.equal(outcome.confidence, outcome.ranked[0].evidence.confidence, `[AMBIGUOUS:${item.label}] top evidence confidence must match outcome.confidence`);
  }

  let falsePositiveMedHigh = 0;
  let falsePositiveAutoSelect = 0;
  for (const trap of adversarialTraps) {
    const outcome = rankCandidates(trap.query, trap.candidates, trap.mediaType);
    if (outcome.confidence === "medium" || outcome.confidence === "high") falsePositiveMedHigh += 1;
    if (outcome.selectedCandidate !== null) falsePositiveAutoSelect += 1;
    assert.ok(
      outcome.confidence === "low" || outcome.confidence === "none",
      `[TRAP:${trap.label}] produced false positive confidence=${outcome.confidence} score=${outcome.topScore}`
    );
    assert.equal(outcome.selectedCandidate, null, `[TRAP:${trap.label}] must not auto-select`);
  }

  assert.equal(top1Hits, positiveCases.length);
  assert.equal(top3Hits, positiveCases.length);
  assert.equal(ambiguousDetected, ambiguousCases.length);
  assert.equal(falseAutoSelectOnAmbiguous, 0);
  assert.equal(falsePositiveMedHigh, 0);
  assert.equal(falsePositiveAutoSelect, 0);
});
