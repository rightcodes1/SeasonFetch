async function request(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export const cinemeta = {
  search(query, type) {
    const movieType = type === 'movie' ? '&type=movie' : '';
    return request(`/api/cinemeta/search?q=${encodeURIComponent(query)}${movieType}`);
  },
  getSeries(id) {
    return request(`/api/cinemeta/series/${encodeURIComponent(id)}`);
  },
  getMovie(imdbId) {
    return request(`/api/cinemeta/movie/${encodeURIComponent(imdbId)}`);
  }
};
