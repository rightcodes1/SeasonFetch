async function request(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export const cinemeta = {
  search(query) {
    return request(`/api/cinemeta/search?q=${encodeURIComponent(query)}`);
  },
  getSeries(id) {
    return request(`/api/cinemeta/series/${encodeURIComponent(id)}`);
  }
};
