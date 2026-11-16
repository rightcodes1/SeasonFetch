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

export async function getEpisodeSources(seriesId, season, episode) {
  const streams = await requestStreams(seriesId, season, episode);
  const result = selectBestSource(streams);

  return {
    episode,
    status: result.status,
    selected: result.selected,
    sources: result.candidates
  };
}

export async function getSeasonSources(seriesId, season, episodeCount) {
  const total = Math.min(Math.max(Number(episodeCount) || 0, 0), 30);
  const results = new Array(total);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= total) return;

      const episode = index + 1;
      try {
        results[index] = await getEpisodeSources(seriesId, season, episode);
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

  await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
  return results;
}
