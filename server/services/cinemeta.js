const BASE_URL = (process.env.CINEMETA_BASE_URL || "https://v3-cinemeta.strem.io").replace(/\/+$/, "");

async function requestJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "SeasonFetch/1.0" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) throw new Error(`Cinemeta returned HTTP ${response.status}`);
  return response.json();
}

function normalizeSeries(item = {}) {
  const genres = Array.isArray(item.genres) ? item.genres : [];

  return {
    id: item.id,
    imdbId: item.id,
    title: item.name || "Unknown title",
    year: item.year || null,
    rating: item.imdbRating || item.rating || null,
    type: genres.slice(0, 2).join(" · ") || "Series",
    synopsis: item.description || "",
    genres,
    poster: item.poster || null
  };
}

async function hydrateSearchResult(series) {
  try {
    const data = await requestJson(`${BASE_URL}/meta/series/${encodeURIComponent(series.imdbId)}.json`);
    return data.meta ? { ...series, ...normalizeSeries(data.meta) } : series;
  } catch {
    return series;
  }
}

export async function searchSeries(query) {
  const cleanQuery = String(query || "").trim();
  if (cleanQuery.length < 2) return [];

  const url = `${BASE_URL}/catalog/series/top/search=${encodeURIComponent(cleanQuery)}.json`;
  const data = await requestJson(url);
  const results = (data.metas || [])
    .filter(item => item.type === "series" && /^tt\d+$/.test(item.id))
    .map(normalizeSeries);
  const hydrated = await Promise.all(results.slice(0, 8).map(hydrateSearchResult));
  return [...hydrated, ...results.slice(8)];
}

function normalizeEpisodes(meta = {}) {
  const videos = Array.isArray(meta.videos) ? meta.videos : [];
  const episodes = {};

  for (const video of videos) {
    const season = Number(video.season);
    const episode = Number(video.episode);
    if (!Number.isInteger(season) || !Number.isInteger(episode)) continue;

    if (!episodes[season]) episodes[season] = [];
    episodes[season].push({
      number: episode,
      title: video.title || `Episode ${episode}`,
      released: video.released || null,
      overview: video.overview || ""
    });
  }

  for (const season of Object.keys(episodes)) episodes[season].sort((a, b) => a.number - b.number);
  return episodes;
}

export async function getSeries(id) {
  if (!/^tt\d+$/.test(id)) throw new Error("Invalid series IMDb ID");
  const data = await requestJson(`${BASE_URL}/meta/series/${encodeURIComponent(id)}.json`);
  if (!data.meta) throw new Error("Series not found");

  return {
    series: normalizeSeries(data.meta),
    episodes: normalizeEpisodes(data.meta)
  };
}
