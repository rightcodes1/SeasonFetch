import { RECOMMENDATION_PROFILES } from "./recommendationProfiles.js";

function qualityScore(release) {
  return ({ "2160p": 1, "1440p": 0.85, "1080p": 0.7, "720p": 0.45, "576p": 0.25, "480p": 0.15 }[release.resolution] || 0) + (release.hdr ? 0.1 : 0) + (["HEVC", "AV1"].includes(release.codec) ? 0.08 : 0);
}

function sizeScore(release, maxSize) {
  if (release.sizeBytes === null || !maxSize) return 0;
  return Math.max(0, 1 - release.sizeBytes / maxSize);
}

function seederScore(release, maxSeeders) {
  if (release.seeders === null || !maxSeeders) return 0;
  return Math.min(1, release.seeders / maxSeeders);
}

export function scoreRelease(release, profileName = "best-overall", context = {}) {
  const profile = RECOMMENDATION_PROFILES[profileName] || RECOMMENDATION_PROFILES["best-overall"];
  const scores = {
    quality: qualityScore(release),
    size: sizeScore(release, context.maxSizeBytes),
    seeders: seederScore(release, context.maxSeeders),
    completeness: Math.min(1, (release.source?.metadataCompleteness || 0) / 7),
    provider: release.preferredProvider || release.provider === "1337x" ? 1 : 0
  };
  const score = Object.entries(profile).reduce((total, [key, weight]) => total + scores[key] * weight, 0);
  return {
    ...release,
    score,
    scoreBreakdown: scores,
    explanation: `quality ${(scores.quality * 100).toFixed(0)}%, size ${(scores.size * 100).toFixed(0)}%, seeders ${(scores.seeders * 100).toFixed(0)}%, metadata ${(scores.completeness * 100).toFixed(0)}%, 1337x provider ${(scores.provider * 100).toFixed(0)}%`
  };
}
