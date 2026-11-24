import { normalizeStream } from "../../utils/sourceParser.js";

export function normalizeRelease(raw = {}, context = {}) {
  const source = normalizeStream(raw);
  if (!source) return null;
  return {
    id: `${source.infoHash}:${source.fileIdx ?? "all"}`,
    title: source.title,
    infoHash: source.infoHash,
    ...(context.mediaType === "movie" ? {} : {
      season: context.season ?? null,
      episode: context.episode ?? null
    }),
    resolution: source.resolution,
    codec: source.codec,
    hdr: source.hdr,
    container: source.filename?.split(".").pop()?.toLowerCase() || null,
    sizeBytes: source.sizeBytes,
    seeders: source.seeders,
    provider: source.provider || source.name || "unknown",
    preferredProvider: Boolean(source.preferredProvider || source.provider === "1337x"),
    releaseType: source.releaseType,
    releaseGroup: source.releaseGroup,
    fileIdx: source.fileIdx,
    audio: {
      classification: source.audioEvidence || "unverified",
      languages: source.audio === "english-dubbed" ? ["en"] : [],
      confidence: source.audioEvidence === "explicit-english-dub" ? 1 : source.audioEvidence === "possible-english-audio" ? 0.5 : 0,
      evidence: source.audio ? [source.audio] : []
    },
    source,
    validation: { status: "unverified", warnings: [] }
  };
}
