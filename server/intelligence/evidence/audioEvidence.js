export function extractAudioEvidence(release) {
  return release?.audio || { classification: "unverified", languages: [], confidence: 0, evidence: [] };
}
