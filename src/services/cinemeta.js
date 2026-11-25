async function request(path, options = {}) {
  const fetchOptions = { headers: { Accept: "application/json" } };
  if (options.signal) fetchOptions.signal = options.signal;
  const response = await fetch(path, fetchOptions);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export function buildCinemetaSearchUrl(query, type, options = {}) {
  const params = new URLSearchParams();
  params.set("q", String(query ?? "").trim());
  if (type === "movie") params.set("type", "movie");
  if (options?.mode === "autocomplete" || options?.mode === "full") {
    params.set("mode", options.mode);
  }
  return `/api/cinemeta/search?${params.toString()}`;
}

export const cinemeta = {
  search(query, type, options = {}) {
    return request(buildCinemetaSearchUrl(query, type, options), { signal: options?.signal });
  },
  getSeries(id, options = {}) {
    return request(`/api/cinemeta/series/${encodeURIComponent(id)}`, { signal: options?.signal });
  },
  getMovie(imdbId, options = {}) {
    return request(`/api/cinemeta/movie/${encodeURIComponent(imdbId)}`, { signal: options?.signal });
  }
};
