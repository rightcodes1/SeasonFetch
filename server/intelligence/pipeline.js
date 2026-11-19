import { normalizeRelease } from "./normalization/normalizeRelease.js";
import { validateRelease } from "./validation/validateRelease.js";
import { validateEpisode } from "./validation/validateEpisode.js";
import { identifyDuplicates } from "./deduplication/identifyDuplicates.js";
import { rankReleases } from "./ranking/rankReleases.js";

export function processReleases(rawResults = [], { season = null, episode = null, profile = "best-overall" } = {}) {
  const normalized = rawResults.map(raw => normalizeRelease(raw, { season, episode })).filter(Boolean);
  const validated = normalized.map(validateRelease).filter(release => release.validation.status !== "invalid");
  const duplicateGroups = identifyDuplicates(validated);
  const ranked = rankReleases(duplicateGroups.map(group => group.representative), profile);
  return {
    normalized,
    validated,
    duplicateGroups,
    ranked,
    recommendations: {
      bestOverall: rankReleases(validated, "best-overall")[0] || null,
      smallestAcceptable: rankReleases(validated, "smallest-acceptable")[0] || null,
      highestQuality: rankReleases(validated, "highest-quality")[0] || null
    },
    episode: validateEpisode(validated)
  };
}
