async function request(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export const torrentio = {
  getSeasonSources(seriesId, season, episodeNumbers, preference = 'default', audioMode = 'any') {
    const episodes = Array.isArray(episodeNumbers) ? episodeNumbers.join(",") : episodeNumbers;
    return request(`/api/torrentio/season/${encodeURIComponent(seriesId)}/${season}?episodeList=${encodeURIComponent(episodes)}&preference=${encodeURIComponent(preference)}&audio=${encodeURIComponent(audioMode)}`);
  }
};
