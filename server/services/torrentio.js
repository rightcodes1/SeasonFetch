import { selectBestSource } from "../utils/sourceParser.js";

const BASE_URL = (process.env.TORRENTIO_BASE_URL || "https://torrentio.strem.fun").replace(/\/+$/, "");

function assertEpisodeParts(seriesId, season, episode) {
  if (!/^tt\d+$/.test(seriesId)) throw new Error("Invalid series IMDb ID");
  if (!Number.isInteger(season) || season < 0) throw new Error("Invalid season number");
  if (!Number.isInteger(episode) || episode < 1) throw new Error("Invalid episode number");
}

async function requestStreams(seriesId, season, episode) {
  assertEpisodeParts(seriesId, season, episode);

  const identifier = `${seriesId}:${season}:${episode}`;
  const url = `${BASE_URL}/stream/series/${encodeURIComponent(identifier)}.json`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SeasonFetch/1.0"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) throw new Error(`Torrentio returned HTTP ${response.status}`);

  const data = await response.json();
  return Array.isArray(data.streams) ? data.streams : [];
}

export async function getEpisodeSources(seriesId, season, episode, preference = "default", englishDubOnly = false) {
  const streams = await requestStreams(seriesId, season, episode);
  const result = selectBestSource(streams, preference, { englishDubOnly });

  return {
    episode,
    status: result.status,
    selected: result.selected,
    sources: result.candidates
  };
}

export async function getSeasonSources(seriesId, season, episodeNumbers, preference = "default", englishDubOnly = false) {
  const requestedEpisodes = Array.isArray(episodeNumbers)
    ? episodeNumbers.filter(number => Number.isInteger(number) && number > 0).slice(0, 30)
    : Array.from({ length: Math.min(Math.max(Number(episodeNumbers) || 0, 0), 30) }, (_, index) => index + 1);
  const results = new Array(requestedEpisodes.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= requestedEpisodes.length) return;

      const episode = requestedEpisodes[index];
      try {
        results[index] = await getEpisodeSources(seriesId, season, episode, preference, englishDubOnly);
      } catch (error) {
        results[index] = {
          episode,
          status: "error",
          selected: null,
          sources: [],
          error: error.message
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, requestedEpisodes.length) }, worker));

  const providerErrors = results.filter(result => result.status === "error").length;
  const available = results.filter(result => result.selected).length;

  return {
    requestedEpisodes,
    results,
    available,
    providerErrors,
    status: providerErrors === results.length && results.length ? "error" : providerErrors ? "partial" : "live"
  };
}
