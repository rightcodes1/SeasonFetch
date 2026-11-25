// Curated, deterministic, media-type-scoped title alias registry.
// Only explicit, high-confidence, low-ambiguity aliases belong here.
// Common short English words (e.g. "got", "her", "you", "it", "dark", "lost")
// are intentionally excluded to prevent false-positive alias collisions.
// Each entry strictly lists only media types whose canonical work and IMDb ID(s)
// are accurately represented by that entry. Multi-installment/multi-remake
// franchise aliases set `ambiguousFranchise: true` so they never silently
// auto-select a single installment without disambiguation.

export function normalizeAliasKey(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // Collapse punctuated initialisms of 3+ single letters (e.g., "S.W.A.T." -> "SWAT", "M*A*S*H" -> "MASH")
    // without affecting normal word separators ("The.Bear", "Mr. Robot").
    .replace(/(^|[^a-zA-Z0-9])([a-zA-Z](?:[.*][a-zA-Z]){2,})[.*]?(?=$|[^a-zA-Z0-9])/g, (_, prefix, seq) => `${prefix}${seq.replace(/[.*]/g, "")}`)
    .replace(/['’‘`]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export const TITLE_ALIAS_ENTRIES = Object.freeze([
  // --- Anime Series (strictly series-scoped to match series canonical titles & IMDb IDs) ---
  {
    id: "attack-on-titan",
    canonicalTitle: "Attack on Titan",
    mediaTypes: ["series"],
    imdbIds: ["tt2560140"],
    aliases: ["shingeki no kyojin", "aot", "snk"],
    kind: "anime"
  },
  {
    id: "demon-slayer",
    canonicalTitle: "Demon Slayer: Kimetsu no Yaiba",
    mediaTypes: ["series"],
    imdbIds: ["tt9335498"],
    aliases: ["kimetsu no yaiba", "demon slayer", "kny"],
    kind: "anime"
  },
  {
    id: "jujutsu-kaisen",
    canonicalTitle: "Jujutsu Kaisen",
    mediaTypes: ["series"],
    imdbIds: ["tt12343534"],
    aliases: ["jjk"],
    kind: "anime"
  },
  {
    id: "my-hero-academia",
    canonicalTitle: "My Hero Academia",
    mediaTypes: ["series"],
    imdbIds: ["tt5626028"],
    aliases: ["boku no hero academia", "mha", "bnha"],
    kind: "anime"
  },
  {
    id: "fullmetal-alchemist-brotherhood",
    canonicalTitle: "Fullmetal Alchemist: Brotherhood",
    mediaTypes: ["series"],
    imdbIds: ["tt1355642"],
    aliases: ["fmab", "fma brotherhood", "hagane no renkinjutsushi brotherhood"],
    kind: "anime"
  },
  {
    id: "frieren",
    canonicalTitle: "Frieren: Beyond Journey's End",
    mediaTypes: ["series"],
    imdbIds: ["tt22248376"],
    aliases: ["sousou no frieren", "sozo no frieren", "frieren"],
    kind: "anime"
  },
  {
    id: "hunter-x-hunter",
    canonicalTitle: "Hunter x Hunter",
    mediaTypes: ["series"],
    imdbIds: ["tt2098220", "tt0426719"],
    aliases: ["hxh", "hunter hunter"],
    ambiguousFranchise: true,
    kind: "anime"
  },
  {
    id: "one-punch-man",
    canonicalTitle: "One-Punch Man",
    mediaTypes: ["series"],
    imdbIds: ["tt4508902"],
    aliases: ["wanpanman", "opm"],
    kind: "anime"
  },
  {
    id: "oshi-no-ko",
    canonicalTitle: "Oshi no Ko",
    mediaTypes: ["series"],
    imdbIds: ["tt21030032"],
    aliases: ["oshinoko"],
    kind: "anime"
  },
  {
    id: "konosuba",
    canonicalTitle: "KonoSuba: God's Blessing on This Wonderful World!",
    mediaTypes: ["series"],
    imdbIds: ["tt5370118"],
    aliases: ["konosuba", "kono subarashii sekai ni shukufuku wo", "kono subarashii sekai ni shukufuku o"],
    kind: "anime"
  },
  {
    id: "solo-leveling",
    canonicalTitle: "Solo Leveling",
    mediaTypes: ["series"],
    imdbIds: ["tt21209876"],
    aliases: ["ore dake level up na ken", "na honjaman level up"],
    kind: "anime"
  },
  {
    id: "chainsaw-man",
    canonicalTitle: "Chainsaw Man",
    mediaTypes: ["series"],
    imdbIds: ["tt13616990"],
    aliases: ["chenso man", "csm"],
    kind: "anime"
  },
  {
    id: "spy-x-family",
    canonicalTitle: "Spy x Family",
    mediaTypes: ["series"],
    imdbIds: ["tt13706018"],
    aliases: ["spy family", "spyxfamily"],
    kind: "anime"
  },
  {
    id: "neon-genesis-evangelion",
    canonicalTitle: "Neon Genesis Evangelion",
    mediaTypes: ["series"],
    imdbIds: ["tt0112159"],
    aliases: ["shin seiki evangelion", "nge"],
    kind: "anime"
  },
  {
    id: "steins-gate",
    canonicalTitle: "Steins;Gate",
    mediaTypes: ["series"],
    imdbIds: ["tt1910272"],
    aliases: ["steinsgate"],
    kind: "anime"
  },
  {
    id: "mob-psycho-100",
    canonicalTitle: "Mob Psycho 100",
    mediaTypes: ["series"],
    imdbIds: ["tt5897304"],
    aliases: ["mob psycho", "mp100"],
    kind: "anime"
  },
  {
    id: "kaguya-sama",
    canonicalTitle: "Kaguya-sama: Love Is War",
    mediaTypes: ["series"],
    imdbIds: ["tt9522300"],
    aliases: ["kaguya sama", "kaguya sama wa kokurasetai"],
    kind: "anime"
  },
  {
    id: "re-zero",
    canonicalTitle: "Re:Zero - Starting Life in Another World",
    mediaTypes: ["series"],
    imdbIds: ["tt5607616"],
    aliases: ["re zero", "rezero", "re zero kara hajimeru isekai seikatsu"],
    kind: "anime"
  },
  {
    id: "mushoku-tensei",
    canonicalTitle: "Mushoku Tensei: Jobless Reincarnation",
    mediaTypes: ["series"],
    imdbIds: ["tt13293588"],
    aliases: ["mushoku tensei", "jobless reincarnation"],
    kind: "anime"
  },
  {
    id: "apothecary-diaries",
    canonicalTitle: "The Apothecary Diaries",
    mediaTypes: ["series"],
    imdbIds: ["tt26743760"],
    aliases: ["kusuriya no hitorigoto", "apothecary diaries"],
    kind: "anime"
  },
  {
    id: "delicious-in-dungeon",
    canonicalTitle: "Delicious in Dungeon",
    mediaTypes: ["series"],
    imdbIds: ["tt21621494"],
    aliases: ["dungeon meshi"],
    kind: "anime"
  },
  {
    id: "dandadan",
    canonicalTitle: "Dan Da Dan",
    mediaTypes: ["series"],
    imdbIds: ["tt30217403"],
    aliases: ["dandadan"],
    kind: "anime"
  },
  {
    id: "erased",
    canonicalTitle: "Erased",
    mediaTypes: ["series"],
    imdbIds: ["tt5249462"],
    aliases: ["boku dake ga inai machi"],
    kind: "anime"
  },
  {
    id: "your-lie-in-april",
    canonicalTitle: "Your Lie in April",
    mediaTypes: ["series"],
    imdbIds: ["tt3895150"],
    aliases: ["shigatsu wa kimi no uso"],
    kind: "anime"
  },
  {
    id: "bleach-tybw",
    canonicalTitle: "Bleach: Thousand-Year Blood War",
    mediaTypes: ["series"],
    imdbIds: ["tt14986406"],
    aliases: ["bleach tybw", "tybw"],
    kind: "anime"
  },
  {
    id: "avatar-the-last-airbender",
    canonicalTitle: "Avatar: The Last Airbender",
    mediaTypes: ["series"],
    imdbIds: ["tt0417299"],
    aliases: ["atla"],
    kind: "abbreviation"
  },

  // --- Anime Movies (strictly movie-scoped to exact movie works & IMDb IDs) ---
  {
    id: "your-name",
    canonicalTitle: "Your Name.",
    mediaTypes: ["movie"],
    imdbIds: ["tt5311514"],
    aliases: ["kimi no na wa"],
    kind: "anime"
  },
  {
    id: "spirited-away",
    canonicalTitle: "Spirited Away",
    mediaTypes: ["movie"],
    imdbIds: ["tt0245429"],
    aliases: ["sen to chihiro no kamikakushi"],
    kind: "anime"
  },
  {
    id: "princess-mononoke",
    canonicalTitle: "Princess Mononoke",
    mediaTypes: ["movie"],
    imdbIds: ["tt0119698"],
    aliases: ["mononoke hime"],
    kind: "anime"
  },
  {
    id: "howls-moving-castle",
    canonicalTitle: "Howl's Moving Castle",
    mediaTypes: ["movie"],
    imdbIds: ["tt0347149"],
    aliases: ["hauru no ugoku shiro"],
    kind: "anime"
  },
  {
    id: "a-silent-voice",
    canonicalTitle: "A Silent Voice",
    mediaTypes: ["movie"],
    imdbIds: ["tt5323662"],
    aliases: ["koe no katachi"],
    kind: "anime"
  },
  {
    id: "weathering-with-you",
    canonicalTitle: "Weathering with You",
    mediaTypes: ["movie"],
    imdbIds: ["tt9426210"],
    aliases: ["tenki no ko"],
    kind: "anime"
  },
  {
    id: "grave-of-the-fireflies",
    canonicalTitle: "Grave of the Fireflies",
    mediaTypes: ["movie"],
    imdbIds: ["tt0095327"],
    aliases: ["hotaru no haka"],
    kind: "anime"
  },
  {
    id: "suzume",
    canonicalTitle: "Suzume",
    mediaTypes: ["movie"],
    imdbIds: ["tt16428256"],
    aliases: ["suzume no tojimari"],
    kind: "anime"
  },
  {
    id: "i-want-to-eat-your-pancreas",
    canonicalTitle: "I Want to Eat Your Pancreas",
    mediaTypes: ["movie"],
    imdbIds: ["tt7236034"],
    aliases: ["kimi no suizou wo tabetai", "kimi no suizo o tabetai"],
    kind: "anime"
  },
  {
    id: "jujutsu-kaisen-0",
    canonicalTitle: "Jujutsu Kaisen 0",
    mediaTypes: ["movie"],
    imdbIds: ["tt14331144"],
    aliases: ["jjk 0", "jjk0"],
    kind: "anime"
  },

  // --- Localized / International Series & Movies ---
  {
    id: "money-heist",
    canonicalTitle: "Money Heist",
    mediaTypes: ["series"],
    imdbIds: ["tt6468322"],
    aliases: ["la casa de papel"],
    kind: "localized"
  },
  {
    id: "squid-game",
    canonicalTitle: "Squid Game",
    mediaTypes: ["series"],
    imdbIds: ["tt10919420"],
    aliases: ["ojingeo geim"],
    kind: "localized"
  },
  {
    id: "all-of-us-are-dead",
    canonicalTitle: "All of Us Are Dead",
    mediaTypes: ["series"],
    imdbIds: ["tt14169960"],
    aliases: ["jigeum uri hakgyoneun"],
    kind: "localized"
  },
  {
    id: "parasite",
    canonicalTitle: "Parasite",
    mediaTypes: ["movie"],
    imdbIds: ["tt6751668"],
    aliases: ["gisaengchung"],
    kind: "localized"
  },
  {
    id: "oldboy",
    canonicalTitle: "Oldboy",
    mediaTypes: ["movie"],
    imdbIds: ["tt0364569"],
    aliases: ["oldeuboi"],
    kind: "localized"
  },
  {
    id: "train-to-busan",
    canonicalTitle: "Train to Busan",
    mediaTypes: ["movie"],
    imdbIds: ["tt5700672"],
    aliases: ["busanhaeng"],
    kind: "localized"
  },
  {
    id: "amelie",
    canonicalTitle: "Amélie",
    mediaTypes: ["movie"],
    imdbIds: ["tt0211915"],
    aliases: ["le fabuleux destin d amelie poulain", "amelie poulain"],
    kind: "localized"
  },
  {
    id: "pans-labyrinth",
    canonicalTitle: "Pan's Labyrinth",
    mediaTypes: ["movie"],
    imdbIds: ["tt0457430"],
    aliases: ["el laberinto del fauno"],
    kind: "localized"
  },
  {
    id: "city-of-god",
    canonicalTitle: "City of God",
    mediaTypes: ["movie"],
    imdbIds: ["tt0317248"],
    aliases: ["cidade de deus"],
    kind: "localized"
  },

  // --- Unambiguous TV / Film Abbreviations ---
  {
    id: "better-call-saul",
    canonicalTitle: "Better Call Saul",
    mediaTypes: ["series"],
    imdbIds: ["tt3032476"],
    aliases: ["bcs"],
    kind: "abbreviation"
  },
  {
    id: "how-i-met-your-mother",
    canonicalTitle: "How I Met Your Mother",
    mediaTypes: ["series"],
    imdbIds: ["tt0460649"],
    aliases: ["himym"],
    kind: "abbreviation"
  },
  {
    id: "the-big-bang-theory",
    canonicalTitle: "The Big Bang Theory",
    mediaTypes: ["series"],
    imdbIds: ["tt0898266"],
    aliases: ["tbbt"],
    kind: "abbreviation"
  },
  {
    id: "the-lord-of-the-rings",
    canonicalTitle: "The Lord of the Rings",
    mediaTypes: ["movie"],
    imdbIds: ["tt0120737", "tt0167261", "tt0167260"],
    aliases: ["lotr"],
    ambiguousFranchise: true,
    kind: "abbreviation"
  }
]);

// Build deterministic lookup indexes once at module load.
const ALIAS_INDEX = new Map();
const CANONICAL_INDEX = new Map();
const IMDB_INDEX = new Map();

for (const entry of TITLE_ALIAS_ENTRIES) {
  const canonicalKey = normalizeAliasKey(entry.canonicalTitle);
  const normalizedEntry = Object.freeze({
    ...entry,
    ambiguousFranchise: Boolean(entry.ambiguousFranchise || (entry.imdbIds && entry.imdbIds.length > 1)),
    canonicalKey,
    normalizedAliases: Object.freeze(entry.aliases.map(normalizeAliasKey).filter(Boolean))
  });

  if (!CANONICAL_INDEX.has(canonicalKey)) CANONICAL_INDEX.set(canonicalKey, []);
  CANONICAL_INDEX.get(canonicalKey).push(normalizedEntry);

  for (const imdbId of entry.imdbIds || []) {
    if (!IMDB_INDEX.has(imdbId)) IMDB_INDEX.set(imdbId, []);
    IMDB_INDEX.get(imdbId).push(normalizedEntry);
  }

  for (const aliasKey of normalizedEntry.normalizedAliases) {
    if (!ALIAS_INDEX.has(aliasKey)) ALIAS_INDEX.set(aliasKey, []);
    ALIAS_INDEX.get(aliasKey).push(normalizedEntry);
  }
}

export function lookupTitleAliases(queryOrKey, mediaType = "series") {
  const key = normalizeAliasKey(queryOrKey);
  if (!key) return [];
  const matches = ALIAS_INDEX.get(key) || [];
  return matches.filter(entry => entry.mediaTypes.includes(mediaType));
}

export function lookupTitleAliasesAnyMedia(queryOrKey) {
  const key = normalizeAliasKey(queryOrKey);
  if (!key) return [];
  return [...(ALIAS_INDEX.get(key) || [])];
}

const ALIAS_CONSISTENCY_STOP_WORDS = new Set([
  "the", "a", "an", "of", "in", "on", "to", "for", "and", "or",
  "at", "by", "with", "is", "it", "from", "as", "into", "your",
  "no", "wa", "ga", "ni", "wo"
]);

function stripLeadingArticleKey(normalized) {
  return String(normalized || "").replace(/^(?:the|a|an)\s+/, "").trim();
}

function getCanonicalBaseKeys(canonicalTitle) {
  const keys = new Set();
  const fullKey = normalizeAliasKey(canonicalTitle);
  if (fullKey) keys.add(fullKey);

  // Allow explicit base title before subtitle delimiters (":" or " - "), e.g.
  // "Demon Slayer: Kimetsu no Yaiba" -> "demon slayer", "Re:Zero - Starting Life..." -> "re zero".
  const colonIdx = String(canonicalTitle || "").indexOf(":");
  if (colonIdx > 0) {
    const beforeColon = normalizeAliasKey(String(canonicalTitle).slice(0, colonIdx));
    if (beforeColon.length >= 5) keys.add(beforeColon);
  }
  const dashIdx = String(canonicalTitle || "").indexOf(" - ");
  if (dashIdx > 0) {
    const beforeDash = normalizeAliasKey(String(canonicalTitle).slice(0, dashIdx));
    if (beforeDash.length >= 5) keys.add(beforeDash);
  }

  return [...keys];
}

export function isAliasTitleConsistent(entry, candidateTitle) {
  const candNorm = normalizeAliasKey(candidateTitle);
  if (!entry || !candNorm) return false;

  // 1. Exact canonical title, leading-article variant, or registered alias match
  if (candNorm === entry.canonicalKey) return true;
  if (stripLeadingArticleKey(candNorm) === stripLeadingArticleKey(entry.canonicalKey)) return true;
  if ((entry.normalizedAliases || []).includes(candNorm)) return true;

  // 2. Word-boundary franchise/subtitle prefix match (never unanchored substring matching like "unerased" ~ "erased")
  const candNoArticle = stripLeadingArticleKey(candNorm);
  const canonicalNoArticle = stripLeadingArticleKey(entry.canonicalKey);
  if (
    candNorm.startsWith(`${entry.canonicalKey} `)
    || (canonicalNoArticle.length >= 4 && candNoArticle.startsWith(`${canonicalNoArticle} `))
  ) {
    return true;
  }

  // 3. Candidate matches the canonical title's explicit subtitle-free base (e.g., "Demon Slayer", "Frieren")
  const baseKeys = getCanonicalBaseKeys(entry.canonicalTitle);
  if (baseKeys.some(base => candNorm === base || candNorm.startsWith(`${base} `))) {
    return true;
  }

  // 4. Meaningful significant-token alignment (never accept a single shared generic word like "man", "hero", "attack", "dead")
  const canonicalTokens = [...new Set(
    entry.canonicalKey.split(" ").filter(t => t.length >= 3 && !ALIAS_CONSISTENCY_STOP_WORDS.has(t))
  )];
  const candTokenList = [...new Set(
    candNorm.split(" ").filter(t => t.length >= 3 && !ALIAS_CONSISTENCY_STOP_WORDS.has(t))
  )];
  if (!canonicalTokens.length || !candTokenList.length) return false;

  const candTokenSet = new Set(candTokenList);
  const shared = canonicalTokens.filter(t => candTokenSet.has(t)).length;
  const requiredShared = canonicalTokens.length <= 2
    ? canonicalTokens.length
    : Math.max(2, Math.ceil(canonicalTokens.length * 0.6));

  return shared >= requiredShared && (shared / candTokenList.length) >= 0.5;
}

export function getKnownAliasesForCandidate(candidate, mediaType = "series") {
  const seen = new Set();
  const entries = [];
  const rawTitle = candidate?.title || candidate?.name || "";
  const pushIfNew = (entry, requireTitleCheck = false) => {
    if (!entry || seen.has(entry.id)) return;
    if (!entry.mediaTypes.includes(mediaType)) return;
    if (requireTitleCheck && !isAliasTitleConsistent(entry, rawTitle)) return;
    seen.add(entry.id);
    entries.push(entry);
  };

  const imdbId = String(candidate?.imdbId || candidate?.id || "").trim().toLowerCase();
  if (imdbId && IMDB_INDEX.has(imdbId)) {
    for (const entry of IMDB_INDEX.get(imdbId)) pushIfNew(entry, true);
  }

  const titleKey = normalizeAliasKey(rawTitle);
  if (titleKey && CANONICAL_INDEX.has(titleKey)) {
    for (const entry of CANONICAL_INDEX.get(titleKey)) pushIfNew(entry, false);
  }

  return entries;
}
