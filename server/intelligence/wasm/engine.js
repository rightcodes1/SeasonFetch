import { readFile } from "node:fs/promises";
import { processNormalizedReleases } from "../pipeline.js";
import { rankReleases } from "../ranking/rankReleases.js";
import { hardFilterRejectionReasons } from "../pipeline.js";

const CONTRACT_VERSION = "seasonfetch.intelligence.v1";
const PROFILE_NAMES = ["best-overall", "smallest-acceptable", "highest-quality", "most-reliable"];
const PROFILE_KEYS = {
  "best-overall": "bestOverall",
  "smallest-acceptable": "smallestAcceptable",
  "highest-quality": "highestQuality",
  "most-reliable": "mostReliable"
};
const RESOLUTIONS = new Set(["any", "480p", "576p", "720p", "1080p", "1440p", "2160p"]);
const CODECS = new Set(["H.264", "HEVC", "AV1"]);
const HDR_TYPES = new Set(["HDR", "Dolby Vision"]);
const AUDIO_CLASSES = new Set(["explicit-english-dub", "possible-english-audio", "unverified"]);

let wasmPromise;

function safeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function safeU32(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum && value <= 0xffff_ffff ? value : null;
}

function safeEnum(value, allowed) {
  return allowed.has(value) ? value : null;
}

function normalizeRequest(context = {}) {
  const filters = context.filters && typeof context.filters === "object" ? context.filters : {};
  const resolution = Object.hasOwn(filters, "resolution")
    ? filters.resolution === null ? "any" : filters.resolution
    : "1080p";
  const profile = PROFILE_NAMES.includes(context.profile) ? context.profile : "best-overall";
  const audioMode = ["any", "english-dubbed-only", "english-dubbed-or-dual"].includes(context.audioMode)
    ? context.audioMode
    : "any";
  return {
    season: safeU32(context.season),
    episode: safeU32(context.episode, 1),
    profile,
    audioMode,
    filters: {
      resolution: RESOLUTIONS.has(resolution) ? resolution : "any",
      maxSizeBytes: safeInteger(filters.maxSizeBytes, 1),
      minSeeders: safeInteger(filters.minSeeders),
      codec: safeEnum(filters.codec, CODECS),
      hdr: safeEnum(filters.hdr, HDR_TYPES)
    }
  };
}

function normalizedCandidate(release) {
  const source = release.source || {};
  const audio = release.audio || {};
  const classification = AUDIO_CLASSES.has(audio.classification) ? audio.classification : "unverified";
  const hash = typeof release.infoHash === "string" && /^[a-f0-9]{40}$/i.test(release.infoHash)
    ? release.infoHash.toLowerCase()
    : null;
  const completeness = safeInteger(source.metadataCompleteness);
  return {
    id: String(release.candidateId || ""),
    title: typeof release.title === "string" ? release.title : "",
    infoHash: hash,
    fileIdx: safeU32(release.fileIdx),
    resolution: safeEnum(release.resolution, RESOLUTIONS) && release.resolution !== "any" ? release.resolution : null,
    codec: safeEnum(release.codec, CODECS),
    hdr: safeEnum(release.hdr, HDR_TYPES),
    container: typeof release.container === "string" ? release.container.slice(0, 32) : null,
    sizeBytes: safeInteger(release.sizeBytes, 0),
    seeders: safeInteger(release.seeders),
    provider: typeof release.provider === "string" ? release.provider.slice(0, 128) : null,
    releaseType: typeof release.releaseType === "string" ? release.releaseType.slice(0, 64) : null,
    releaseGroup: typeof release.releaseGroup === "string" ? release.releaseGroup.slice(0, 128) : null,
    metadataCompleteness: Math.min(completeness ?? 0, 7),
    audio: {
      classification,
      languages: Array.isArray(audio.languages) ? audio.languages.filter(item => typeof item === "string").slice(0, 16).map(item => item.slice(0, 16)) : [],
      confidence: Number.isFinite(audio.confidence) && audio.confidence >= 0 && audio.confidence <= 1 ? audio.confidence : 0,
      evidence: Array.isArray(audio.evidence) ? audio.evidence.filter(item => typeof item === "string").slice(0, 16).map(item => item.slice(0, 128)) : []
    }
  };
}

export function buildEngineInput(releases, context = {}) {
  const candidates = (Array.isArray(releases) ? releases : []).map(normalizedCandidate);
  const ids = new Set();
  for (const candidate of candidates) {
    if (!candidate.id || ids.has(candidate.id)) {
      throw new Error("WASM adapter requires unique stable candidate IDs");
    }
    ids.add(candidate.id);
  }
  return {
    contractVersion: CONTRACT_VERSION,
    request: normalizeRequest(context),
    candidates
  };
}

function pipelineOptions(request) {
  return {
    profile: request.profile,
    audioMode: request.audioMode,
    filters: {
      ...request.filters,
      resolution: request.filters.resolution ?? "any"
    }
  };
}

function rankedRecord(release) {
  return {
    candidateId: release.candidateId,
    score: release.score,
    scoreBreakdown: release.scoreBreakdown,
    explanation: release.explanation
  };
}

export function projectJavaScriptOutput(input, actual = {}) {
  if (input?.contractVersion !== CONTRACT_VERSION || !Array.isArray(input.candidates)) {
    throw new Error("Unsupported or malformed JavaScript shadow input");
  }
  const normalized = input.candidates.map(candidate => ({
    ...candidate,
    candidateId: candidate.id,
    id: candidate.id,
    source: { metadataCompleteness: candidate.metadataCompleteness }
  }));
  const result = actual.result || processNormalizedReleases(normalized, pipelineOptions(input.request));
  const releasesById = new Map((actual.result?.normalized || normalized).map(release => [release.candidateId, release]));
  const validationById = new Map([...result.invalid, ...result.validated].map(release => [release.candidateId, release.validation]));
  const eligibleIds = new Set(result.eligible.map(release => release.candidateId));
  const rejectedIds = input.candidates.map(candidate => candidate.id).filter(id => !eligibleIds.has(id));
  const invalidIds = new Set(result.invalid.map(release => release.candidateId));
  const filters = actual.context
    ? { resolution: "1080p", ...(actual.context.filters || {}) }
    : pipelineOptions(input.request).filters;
  const audioMode = actual.context?.audioMode ?? input.request.audioMode;
  const rejectionReasons = rejectedIds.map(candidateId => {
    const validation = validationById.get(candidateId);
    const reasons = invalidIds.has(candidateId)
      ? validation?.warnings || []
      : hardFilterRejectionReasons(releasesById.get(candidateId), {
        ...filters,
        audioMode
      });
    return { candidateId, reasons };
  });
  const profileRanks = Object.fromEntries(PROFILE_NAMES.map(profile => [
    PROFILE_KEYS[profile], rankReleases(result.eligibleRepresentatives, profile).map(rankedRecord)
  ]));
  const recommendations = Object.fromEntries(PROFILE_NAMES.map(profile => [
    PROFILE_KEYS[profile], profileRanks[PROFILE_KEYS[profile]][0]?.candidateId ?? null
  ]));
  const duplicateGroups = result.duplicateGroups.map(group => ({
    id: group.id,
    candidateIds: group.releases.map(release => release.candidateId),
    representativeId: group.representative.candidateId
  }));
  const rankedIds = profileRanks[PROFILE_KEYS[input.request.profile]].map(item => item.candidateId);

  return {
    contractVersion: CONTRACT_VERSION,
    status: "ok",
    counts: {
      discovered: input.candidates.length,
      validated: result.validated.length,
      eligible: result.eligible.length,
      rejected: rejectedIds.length,
      unique: result.eligibleRepresentatives.length
    },
    eligibleIds: result.eligible.map(release => release.candidateId),
    eligibleRepresentativeIds: result.eligibleRepresentatives.map(release => release.candidateId),
    rejectedIds,
    validationResults: input.candidates.map(candidate => ({
      candidateId: candidate.id,
      status: validationById.get(candidate.id)?.status || "invalid",
      warnings: validationById.get(candidate.id)?.warnings || []
    })),
    rejectionReasons,
    duplicateGroups,
    rankedIds,
    rankings: {
      bestOverall: profileRanks.bestOverall,
      smallestAcceptable: profileRanks.smallestAcceptable,
      highestQuality: profileRanks.highestQuality,
      mostReliable: profileRanks.mostReliable
    },
    recommendations,
    episode: result.episode
  };
}

function assertResultIntegrity(output, input) {
  if (output?.contractVersion !== CONTRACT_VERSION || output.status !== "ok") {
    throw new Error("WASM returned an incompatible output contract");
  }
  const candidateIds = new Set(input.candidates.map(candidate => candidate.id));
  const representativeIds = new Set(output.eligibleRepresentativeIds || []);
  for (const key of ["eligibleIds", "eligibleRepresentativeIds", "rejectedIds", "rankedIds"]) {
    const values = output[key];
    if (!Array.isArray(values) || values.some(id => !candidateIds.has(id))) {
      throw new Error(`WASM returned an invalid ${key} list`);
    }
  }
  for (const id of representativeIds) {
    if (!output.eligibleIds.includes(id)) throw new Error("WASM representative is not eligible");
  }
  for (const profile of Object.values(output.rankings || {})) {
    const ids = profile.map(item => item.candidateId);
    if (new Set(ids).size !== ids.length || ids.some(id => !representativeIds.has(id))) {
      throw new Error("WASM ranking contains duplicate or ineligible candidates");
    }
  }
  for (const recommendation of Object.values(output.recommendations || {})) {
    if (recommendation !== null && !representativeIds.has(recommendation)) {
      throw new Error("WASM recommendation is not an eligible representative");
    }
  }
  if (output.episode?.releaseCount !== representativeIds.size
    || output.episode?.status !== (representativeIds.size ? "available" : "missing")) {
    throw new Error("WASM episode availability does not match eligible representatives");
  }
  const checkNoProviderData = value => {
    if (Array.isArray(value)) return value.forEach(checkNoProviderData);
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (/magnet|tracker|sourceurl|externalurl/i.test(key)) throw new Error("WASM output contains provider transport data");
      checkNoProviderData(nested);
    }
  };
  checkNoProviderData(output);
}

export async function runWasm(input) {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const glue = await import("./pkg/seasonfetch_engine.js");
      const bytes = await readFile(new URL("./pkg/seasonfetch_engine_bg.wasm", import.meta.url));
      glue.initSync({ module: new WebAssembly.Module(bytes) });
      return glue.process_json_wasm;
    })().catch(error => {
      wasmPromise = undefined;
      throw error;
    });
  }
  const processJson = await wasmPromise;
  const output = JSON.parse(processJson(JSON.stringify(input)));
  assertResultIntegrity(output, input);
  return output;
}

export function contractOutputsMatch(left, right) {
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
