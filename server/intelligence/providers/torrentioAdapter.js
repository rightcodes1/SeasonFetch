import { processReleases } from "../pipeline.js";
import {
  buildEngineInput,
  contractOutputsMatch,
  projectJavaScriptOutput,
  runWasm
} from "../wasm/engine.js";

let reportedWasmFailure = false;

const profileKeys = {
  "best-overall": "bestOverall",
  "smallest-acceptable": "smallestAcceptable",
  "highest-quality": "highestQuality",
  "most-reliable": "mostReliable"
};

function fromWasmOutput(output, normalized, requestProfile) {
  const releasesById = new Map(normalized.map(release => [release.candidateId, release]));
  const validationById = new Map(output.validationResults.map(result => [result.candidateId, result]));
  const invalidIds = new Set(output.validationResults.filter(result => result.status === "invalid").map(result => result.candidateId));
  const releaseFor = (candidateId, validation = true) => {
    const release = releasesById.get(candidateId);
    if (!release) throw new Error("WASM returned an unknown candidate ID");
    return validation ? { ...release, validation: validationById.get(candidateId) } : release;
  };
  const eligible = output.eligibleIds.map(id => releaseFor(id));
  const eligibleRepresentatives = output.eligibleRepresentativeIds.map(id => releaseFor(id));
  const rankedByProfile = Object.fromEntries(Object.entries(output.rankings).map(([profile, ranked]) => [
    profile,
    ranked.map(item => ({
      ...releaseFor(item.candidateId),
      score: item.score,
      scoreBreakdown: item.scoreBreakdown,
      explanation: item.explanation
    }))
  ]));
  const recommendations = Object.fromEntries(Object.entries(output.recommendations).map(([profile, candidateId]) => [
    profile,
    candidateId === null ? null : rankedByProfile[profile].find(release => release.candidateId === candidateId) || null
  ]));
  const duplicateGroups = output.duplicateGroups.map(group => ({
    id: group.id,
    releases: group.candidateIds.map(id => releaseFor(id)),
    representative: releaseFor(group.representativeId)
  }));
  const invalid = [...invalidIds].map(id => releaseFor(id));
  const rejected = output.rejectedIds.filter(id => !invalidIds.has(id)).map(id => releaseFor(id));
  const selectedProfile = rankedByProfile[profileKeys[requestProfile]];
  if (!selectedProfile) throw new Error("WASM returned an unknown ranking profile");

  return {
    normalized: normalized.map(release => ({ ...release, validation: validationById.get(release.candidateId) })),
    invalid,
    validated: output.validationResults.filter(result => result.status !== "invalid").map(result => releaseFor(result.candidateId)),
    eligible,
    eligibleRepresentatives,
    rejected,
    duplicateGroups,
    ranked: output.rankedIds.map((id, index) => {
      const release = selectedProfile[index];
      if (!release || release.candidateId !== id) throw new Error("WASM ranked IDs do not match ranked records");
      return release;
    }),
    recommendations,
    episode: output.episode,
    counts: output.counts
  };
}

export async function processTorrentioResults(streams, context = {}, runtime = {}) {
  const javascript = processReleases(streams, context);
  const mode = process.env.SEASONFETCH_INTELLIGENCE_MODE || "javascript";
  if (mode !== "wasm-shadow" && mode !== "wasm") return javascript;

  try {
    const wasmRunner = runtime.runWasm || runWasm;
    const projector = runtime.projectJavaScriptOutput || projectJavaScriptOutput;
    const matches = runtime.contractOutputsMatch || contractOutputsMatch;
    const input = buildEngineInput(javascript.normalized, context);
    const rustOutput = await wasmRunner(input);
    const javascriptContract = projector(input, { result: javascript, context });
    const parity = matches(javascriptContract, rustOutput);
    if (mode === "wasm-shadow") {
      if (!parity) console.warn("SeasonFetch WASM shadow mismatch; JavaScript remains authoritative.");
      return javascript;
    }
    if (!parity) {
      console.warn("SeasonFetch WASM parity guard failed; falling back to JavaScript.");
      return javascript;
    }
    return fromWasmOutput(rustOutput, javascript.normalized, input.request.profile);
  } catch (error) {
    if (!reportedWasmFailure) {
      console.warn(`SeasonFetch WASM unavailable; JavaScript fallback remains active (${error?.message || "initialization error"}).`);
      reportedWasmFailure = true;
    }
    return javascript;
  }
}
