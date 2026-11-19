#!/usr/bin/env node

const BASE_URL = (process.env.SEASONFETCH_BASE_URL || "https://season-fetch.vercel.app").replace(/\/$/, "");
const preference = process.env.SEASONFETCH_PREFERENCE || "best-overall";
const cases = [
  { title: "Breaking Bad", seriesId: "tt0903747", season: 1, episodes: [1, 2, 3] },
  { title: "The Bear", seriesId: "tt14452776", season: 1, episodes: [1, 2, 3] },
  { title: "Severance", seriesId: "tt11280740", season: 1, episodes: [1, 2, 3] }
];

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * fraction))];
}

async function scan(item) {
  const query = new URLSearchParams({
    episodeList: item.episodes.join(","),
    preference,
    audio: "any",
    resolution: "1080p"
  });
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/api/torrentio/season/${item.seriesId}/${item.season}?${query}`);
  const elapsedMs = Math.round(performance.now() - started);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${item.title}: HTTP ${response.status} ${body.error || "request failed"}`);

  const results = body.results || [];
  const selected = results.map(result => result.selected).filter(Boolean);
  const knownSizes = selected.filter(source => Number.isFinite(source.sizeBytes));
  const knownSeeders = selected.filter(source => Number.isFinite(source.seeders));
  const explicitDub = selected.filter(source => source.audioEvidence === "explicit-english-dub").length;
  const possibleAudio = selected.filter(source => source.audioEvidence === "possible-english-audio").length;

  return {
    title: item.title,
    seriesId: item.seriesId,
    season: item.season,
    requestedEpisodes: item.episodes.length,
    usableEpisodes: selected.length,
    coverage: item.episodes.length ? selected.length / item.episodes.length : 0,
    knownSizeEpisodes: knownSizes.length,
    knownSeederEpisodes: knownSeeders.length,
    explicitEnglishDubEpisodes: explicitDub,
    possibleEnglishAudioEpisodes: possibleAudio,
    estimatedTotalSizeBytes: body.integrity?.estimatedTotalSizeBytes ?? (knownSizes.length ? knownSizes.reduce((sum, source) => sum + source.sizeBytes, 0) : null),
    averageSeeders: knownSeeders.length ? Math.round(knownSeeders.reduce((sum, source) => sum + source.seeders, 0) / knownSeeders.length) : null,
    missingEpisodes: body.integrity?.missingEpisodes || [],
    elapsedMs
  };
}

const started = new Date().toISOString();
const results = [];
for (const item of cases) {
  try {
    results.push(await scan(item));
  } catch (error) {
    results.push({ title: item.title, error: error.message });
  }
}

const completed = results.filter(result => !result.error);
const report = {
  generatedAt: started,
  baseUrl: BASE_URL,
  preference,
  testSet: cases.map(({ title, seriesId, season, episodes }) => ({ title, seriesId, season, episodes })),
  results,
  summary: {
    successfulCases: completed.length,
    totalCases: cases.length,
    averageCoverage: completed.length ? completed.reduce((sum, result) => sum + result.coverage, 0) / completed.length : null,
    p50ScanMs: percentile(completed.map(result => result.elapsedMs), 0.5),
    p95ScanMs: percentile(completed.map(result => result.elapsedMs), 0.95),
    totalUsableEpisodes: completed.reduce((sum, result) => sum + result.usableEpisodes, 0),
    totalRequestedEpisodes: completed.reduce((sum, result) => sum + result.requestedEpisodes, 0)
  }
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
