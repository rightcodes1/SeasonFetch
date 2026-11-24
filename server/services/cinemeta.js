const BASE_URL = (process.env.CINEMETA_BASE_URL || "https://v3-cinemeta.strem.io").replace(/\/+$/, "");

async function requestJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "SeasonFetch/1.0" },
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    const wrapped = new Error(error.name === "TimeoutError" ? "Cinemeta request timed out" : "Cinemeta request failed");
    wrapped.statusCode = error.name === "TimeoutError" ? 504 : 502;
    throw wrapped;
  }

  if (!response.ok) {
    const error = new Error(`Cinemeta returned HTTP ${response.status}`);
    error.statusCode = response.status === 404 ? 404 : response.status >= 500 ? 502 : 502;
    throw error;
  }
  return response.json();
}

function normalizeMetadata(item = {}, mediaType = "series") {
  const genres = Array.isArray(item.genres) ? item.genres : [];

  return {
    id: item.id,
    imdbId: item.id,
    title: item.name || "Unknown title",
    year: item.year || null,
    rating: item.imdbRating || item.rating || null,
    // `type` has historically been the genre/display label in this API.
    type: genres.slice(0, 2).join(" · ") || (mediaType === "movie" ? "Movie" : "Series"),
    synopsis: item.description || "",
    genres,
    poster: item.poster || null,
    mediaType
  };
}

function normalizeSeries(item = {}) {
  return normalizeMetadata(item, "series");
}

function normalizeMovie(item = {}) {
  return normalizeMetadata(item, "movie");
}

async function hydrateSearchResult(item, mediaType) {
  try {
    const data = await requestJson(`${BASE_URL}/meta/${mediaType}/${encodeURIComponent(item.imdbId)}.json`);
    const normalize = mediaType === "movie" ? normalizeMovie : normalizeSeries;
    return data.meta ? { ...item, ...normalize(data.meta) } : item;
  } catch {
    return item;
  }
}

async function searchByType(query, mediaType) {
  const cleanQuery = String(query || "").trim();
  if (cleanQuery.length < 2) return [];

  const url = `${BASE_URL}/catalog/${mediaType}/top/search=${encodeURIComponent(cleanQuery)}.json`;
  const data = await requestJson(url);
  const normalize = mediaType === "movie" ? normalizeMovie : normalizeSeries;
  const results = (data.metas || [])
    .filter(item => item.type === mediaType && /^tt\d+$/.test(item.id))
    .map(normalize);
  const hydrated = await Promise.all(results.slice(0, 8).map(item => hydrateSearchResult(item, mediaType)));
  return [...hydrated, ...results.slice(8)];
}

export async function searchSeries(query) {
  return searchByType(query, "series");
}

export async function searchMovies(query) {
  return searchByType(query, "movie");
}

export async function searchCinemeta(query, mediaType = "series") {
  if (!new Set(["movie", "series"]).has(mediaType)) throw new Error("Invalid Cinemeta media type");
  return searchByType(query, mediaType);
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

function isValidImdbId(id) {
  return typeof id === "string" && /^tt\d+$/.test(id);
}

export async function getSeries(id) {
  if (!isValidImdbId(id)) throw new Error("Invalid series IMDb ID");
  const data = await requestJson(`${BASE_URL}/meta/series/${encodeURIComponent(id)}.json`);
  if (!data.meta) {
    const error = new Error("Series not found");
    error.statusCode = 404;
    throw error;
  }

  return {
    series: normalizeSeries(data.meta),
    episodes: normalizeEpisodes(data.meta)
  };
}

export async function getMovie(id) {
  if (!isValidImdbId(id)) {
    const error = new Error("Invalid movie IMDb ID");
    error.statusCode = 400;
    throw error;
  }
  const data = await requestJson(`${BASE_URL}/meta/movie/${encodeURIComponent(id)}.json`);
  if (!data.meta) {
    const error = new Error("Movie not found");
    error.statusCode = 404;
    throw error;
  }
  return { movie: normalizeMovie(data.meta) };
}
