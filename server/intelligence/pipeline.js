import { normalizeRelease } from "./normalization/normalizeRelease.js";
import { validateRelease } from "./validation/validateRelease.js";
import { validateEpisode } from "./validation/validateEpisode.js";
import { identifyDuplicates } from "./deduplication/identifyDuplicates.js";
import { rankReleases } from "./ranking/rankReleases.js";

const CANDIDATE_ORDINAL_WIDTH = 6;

export function hardFilterRejectionReasons(release, {
  resolution = "1080p",
  maxSizeBytes = null,
  minSeeders = null,
  codec = null,
  hdr = null,
  audioMode = "any"
} = {}) {
  if (!release) return ["candidate-unavailable"];
  const reasons = [];
  if (resolution != null && resolution !== "any" && release.resolution !== resolution) {
    reasons.push("resolution-mismatch");
  }
  if (Number.isFinite(maxSizeBytes)) {
    if (release.sizeBytes === null || release.sizeBytes === undefined) reasons.push("size-unknown");
    else if (release.sizeBytes > maxSizeBytes) reasons.push("size-over-limit");
  }
  if (Number.isFinite(minSeeders)) {
    if (release.seeders === null || release.seeders === undefined) reasons.push("seeders-unknown");
    else if (release.seeders < minSeeders) reasons.push("seeders-below-minimum");
  }
  if (codec && release.codec !== codec) reasons.push("codec-mismatch");
  if (hdr && release.hdr !== hdr) reasons.push("hdr-mismatch");
  if (audioMode === "english-dubbed-only" && release.audio?.classification !== "explicit-english-dub") {
    reasons.push("english-audio-unconfirmed");
  } else if (audioMode === "english-dubbed-or-dual"
    && !["explicit-english-dub", "possible-english-audio"].includes(release.audio?.classification)) {
    reasons.push("english-audio-unconfirmed");
  }
  return reasons;
}

export function recommendationProfileForPreference(preference = "default") {
  if (["smallest", "smallest-acceptable", "default"].includes(preference)) return "smallest-acceptable";
  if (["seeders", "most-reliable"].includes(preference)) return "most-reliable";
  if (["quality", "highest-quality"].includes(preference)) return "highest-quality";
  return "best-overall";
}

function evaluateNormalizedReleases(normalized, options) {
  const checked = normalized.map(validateRelease);
  const invalid = checked.filter(release => release.validation.status === "invalid");
  const validated = checked.filter(release => release.validation.status !== "invalid");
  const eligible = validated.filter(release => hardFilterRejectionReasons(release, {
    ...options.filters,
    audioMode: options.audioMode
  }).length === 0);
  const duplicateGroups = identifyDuplicates(eligible);
  const eligibleRepresentatives = duplicateGroups.map(group => group.representative);
  const ranked = rankReleases(eligibleRepresentatives, options.profile);
  return {
    normalized: checked,
    invalid,
    validated,
    eligible,
    eligibleRepresentatives,
    rejected: validated.filter(release => !eligible.includes(release)),
    duplicateGroups,
    ranked,
    recommendations: {
      bestOverall: rankReleases(eligibleRepresentatives, "best-overall")[0] || null,
      smallestAcceptable: rankReleases(eligibleRepresentatives, "smallest-acceptable")[0] || null,
      highestQuality: rankReleases(eligibleRepresentatives, "highest-quality")[0] || null,
      mostReliable: rankReleases(eligibleRepresentatives, "most-reliable")[0] || null
    },
    episode: validateEpisode(eligibleRepresentatives)
  };
}

export function processNormalizedReleases(normalizedReleases = [], {
  profile = "best-overall",
  filters = {},
  audioMode = "any"
} = {}) {
  const seenIds = new Set();
  const normalized = (Array.isArray(normalizedReleases) ? normalizedReleases : []).map((release, index) => {
    const candidateId = String(release?.candidateId ?? release?.id ?? `candidate-${index}`);
    if (!candidateId || seenIds.has(candidateId)) {
      throw new Error("Normalized candidate IDs must be unique and non-empty");
    }
    seenIds.add(candidateId);
    return { ...release, id: release?.id ?? candidateId, candidateId };
  });
  return evaluateNormalizedReleases(normalized, { profile, filters, audioMode });
}

export function processReleases(rawResults = [], {
  season = null,
  episode = null,
  profile = "best-overall",
  filters = {},
  audioMode = "any"
} = {}) {
  const raw = Array.isArray(rawResults) ? rawResults : [];
  const normalized = raw.map((item, index) => {
    const release = normalizeRelease(item, { season, episode });
    if (!release) return null;
    const ordinal = String(index).padStart(CANDIDATE_ORDINAL_WIDTH, "0");
    return { ...release, candidateId: `${release.id}#${ordinal}` };
  }).filter(Boolean);
  return evaluateNormalizedReleases(normalized, { profile, filters, audioMode });
}
