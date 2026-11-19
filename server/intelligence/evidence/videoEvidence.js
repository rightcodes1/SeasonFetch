export function extractVideoEvidence(release) {
  return {
    resolution: release?.resolution ?? null,
    codec: release?.codec ?? null,
    hdr: release?.hdr ?? null,
    container: release?.container ?? null
  };
}
