export function calculateSeasonSizeEstimate(results = []) {
  const episodes = Array.isArray(results) ? results : [];
  const knownSizes = episodes
    .map(result => result?.selected?.sizeBytes)
    .filter(sizeBytes => Number.isFinite(sizeBytes) && sizeBytes > 0);
  const knownSizeBytes = knownSizes.reduce((total, sizeBytes) => total + sizeBytes, 0);
  const unknownEpisodeCount = episodes.length - knownSizes.length;

  return {
    knownSizeBytes: knownSizeBytes || null,
    knownEpisodeCount: knownSizes.length,
    unknownEpisodeCount,
    complete: episodes.length > 0 && unknownEpisodeCount === 0
  };
}
