import { scoreRelease } from "./scoreRelease.js";

export function rankReleases(releases = [], profile = "best-overall") {
  const maxSizeBytes = Math.max(...releases.map(release => release.sizeBytes || 0), 0);
  const maxSeeders = Math.max(...releases.map(release => release.seeders || 0), 0);
  return releases
    .map(release => scoreRelease(release, profile, { maxSizeBytes, maxSeeders }))
    .sort((a, b) => b.score - a.score
      || (b.seeders ?? -1) - (a.seeders ?? -1)
      || compareStableIds(a, b));
}

function compareStableIds(left, right) {
  const a = String(left?.candidateId ?? left?.id ?? "");
  const b = String(right?.candidateId ?? right?.id ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}
