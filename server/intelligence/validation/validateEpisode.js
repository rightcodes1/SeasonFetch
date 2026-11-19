export function validateEpisode(releases = []) {
  return {
    status: releases.length ? "available" : "missing",
    releaseCount: releases.length,
    warnings: releases.length ? [] : ["no-usable-releases"]
  };
}
