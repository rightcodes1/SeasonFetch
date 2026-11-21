import { processTorrentioResults } from "../intelligence/providers/torrentioAdapter.js";
import { recommendationProfileForPreference } from "../intelligence/pipeline.js";

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

export async function getEpisodeSources(seriesId, season, episode, preference = "default", audioMode = "any", filters = {}) {
  const streams = await requestStreams(seriesId, season, episode);
  const intelligence = await processTorrentioResults(streams, {
    season,
    episode,
    profile: recommendationProfileForPreference(preference),
    filters,
    audioMode
  });
  const selectedRelease = intelligence.recommendations[recommendationKey(preference)] || intelligence.ranked[0] || null;
  const selected = selectedRelease?.source || null;
  const candidates = intelligence.ranked.map(release => release.source);

  return {
    episode,
    status: selected ? selected.sizeBytes === null ? "size-unknown" : "selected" : "unavailable",
    selected,
    sources: candidates,
    intelligence: {
      validatedCount: intelligence.validated.length,
      eligible: intelligence.eligible,
      rejected: intelligence.rejected,
      duplicateGroupCount: intelligence.duplicateGroups.length,
      recommendations: intelligence.recommendations,
      ranked: intelligence.ranked
    },
    selectionReason: selectedRelease ? selectionReason(selectedRelease) : "No source met the active hard filters."
  };
}

function publicRelease(release) {
  if (!release) return null;
  const { candidateId, ...publicFields } = release;
  if (!publicFields.validation || typeof publicFields.validation !== "object") return publicFields;
  const { candidateId: validationCandidateId, ...publicValidation } = publicFields.validation;
  return { ...publicFields, validation: publicValidation };
}

function publicReleaseList(releases) {
  return releases.map(publicRelease);
}

function recommendationKey(preference) {
  if (["smallest", "smallest-acceptable", "default"].includes(preference)) return "smallestAcceptable";
  if (["seeders", "most-reliable"].includes(preference)) return "mostReliable";
  if (["quality", "highest-quality"].includes(preference)) return "highestQuality";
  return "bestOverall";
}

function selectionReason(release) {
  return [
    release.resolution ? `${release.resolution} requirement` : "available resolution metadata",
    release.sizeBytes === null ? "size unknown" : `${release.source.sizeLabel} known size`,
    release.seeders === null ? "seeder count unknown" : `${release.seeders} seeders`,
    release.audio.classification === "explicit-english-dub" ? "explicit English Dub metadata" : release.audio.classification === "possible-english-audio" ? "possible English audio metadata" : "audio language unverified"
  ].join(", ");
}

export async function getSeasonSources(seriesId, season, episodeNumbers, preference = "default", audioMode = "any", filters = {}) {
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
        results[index] = await getEpisodeSources(seriesId, season, episode, preference, audioMode, filters);
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
  const selected = results.map(result => result.selected).filter(Boolean);
  const resolutions = [...new Set(selected.map(source => source.resolution).filter(Boolean))];
  const audioEvidence = [...new Set(selected.map(source => source.audioEvidence).filter(Boolean))];
  const releaseGroups = [...new Set(selected.map(source => source.releaseGroup).filter(Boolean))];
  const totalSizeBytes = selected.reduce((total, source) => total + (source.sizeBytes || 0), 0);

  return {
    requestedEpisodes,
    results,
    available,
    providerErrors,
    integrity: {
      usableEpisodes: available,
      missingEpisodes: requestedEpisodes.filter(episode => !results.find(result => result.episode === episode)?.selected),
      resolutionConsistency: resolutions.length === 1 ? resolutions[0] : resolutions.length ? "mixed" : "unknown",
      audioConsistency: audioEvidence.length === 1 ? audioEvidence[0] : audioEvidence.length ? "mixed" : "unknown",
      releaseGroups,
      estimatedTotalSizeBytes: totalSizeBytes || null,
      weakEpisodes: results.filter(result => result.selected && (result.selected.seeders === null || result.selected.sizeBytes === null)).map(result => result.episode)
    },
    status: providerErrors === results.length && results.length ? "error" : providerErrors ? "partial" : "live"
  };
}
