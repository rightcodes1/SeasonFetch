import { normalizeRelease } from "./normalization/normalizeRelease.js";
import { validateRelease } from "./validation/validateRelease.js";
import { validateEpisode } from "./validation/validateEpisode.js";
import { identifyDuplicates } from "./deduplication/identifyDuplicates.js";
import { rankReleases } from "./ranking/rankReleases.js";

function matchesHardFilters(release, { resolution = "1080p", maxSizeBytes = null, minSeeders = null, codec = null, hdr = null, audioMode = "any" } = {}) {
  if (resolution !== "any" && release.resolution !== resolution) return false;
  if (Number.isFinite(maxSizeBytes) && (release.sizeBytes === null || release.sizeBytes > maxSizeBytes)) return false;
  if (Number.isFinite(minSeeders) && (release.seeders === null || release.seeders < minSeeders)) return false;
  if (codec && release.codec !== codec) return false;
  if (hdr && release.hdr !== hdr) return false;
  if (audioMode === "english-dubbed-only" && release.audio.classification !== "explicit-english-dub") return false;
  if (audioMode === "english-dubbed-or-dual" && !["explicit-english-dub", "possible-english-audio"].includes(release.audio.classification)) return false;
  return true;
}

export function recommendationProfileForPreference(preference = "default") {
  if (["smallest", "smallest-acceptable", "default"].includes(preference)) return "smallest-acceptable";
  if (["seeders", "most-reliable"].includes(preference)) return "most-reliable";
  if (["quality", "highest-quality"].includes(preference)) return "highest-quality";
  return "best-overall";
}

export function processReleases(rawResults = [], { season = null, episode = null, profile = "best-overall", filters = {}, audioMode = "any" } = {}) {
  const normalized = rawResults.map(raw => normalizeRelease(raw, { season, episode })).filter(Boolean);
  const validated = normalized.map(validateRelease).filter(release => release.validation.status !== "invalid");
  const eligible = validated.filter(release => matchesHardFilters(release, { ...filters, audioMode }));
  const duplicateGroups = identifyDuplicates(eligible);
  const ranked = rankReleases(duplicateGroups.map(group => group.representative), profile);
  return {
    normalized,
    validated,
    eligible,
    rejected: validated.filter(release => !eligible.includes(release)),
    duplicateGroups,
    ranked,
    recommendations: {
      bestOverall: rankReleases(eligible, "best-overall")[0] || null,
      smallestAcceptable: rankReleases(eligible, "smallest-acceptable")[0] || null,
      highestQuality: rankReleases(eligible, "highest-quality")[0] || null,
      mostReliable: rankReleases(eligible, "most-reliable")[0] || null
    },
    episode: validateEpisode(validated)
  };
}
