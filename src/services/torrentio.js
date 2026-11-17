async function request(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export const torrentio = {
  getSeasonSources(seriesId, season, episodeNumbers, preference = 'default', audioMode = 'any', filters = {}) {
    const episodes = Array.isArray(episodeNumbers) ? episodeNumbers.join(",") : episodeNumbers;
    const params = new URLSearchParams({ episodeList: episodes, preference, audio: audioMode });
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== "") params.set(key, String(value)); });
    return request(`/api/torrentio/season/${encodeURIComponent(seriesId)}/${season}?${params.toString()}`);
  }
};
