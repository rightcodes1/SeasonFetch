const HASH_REGEX = /^[a-fA-F0-9]{40}$/;

const SIZE_UNITS = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4
};

const FALLBACK_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.qu.ax:6969/announce",
  "udp://tracker.uw0.xyz:6969/announce",
  "http://tracker.renfei.net:8080/announce",
  "http://tracker2.dler.org:80/announce"
];

export function parseSize(text = "") {
  const match = String(text).match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB|B)\b/i);
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  return Math.round(value * SIZE_UNITS[unit]);
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

export function has1080p(text = "") {
  return /(^|[^a-zA-Z0-9])1080p($|[^a-zA-Z0-9])/i.test(String(text));
}

function detectResolution(text = "") {
  const match = String(text).match(/(?:^|[^0-9])(2160p|1440p|1080p|720p|576p|480p)(?:$|[^0-9])/i);
  return match ? match[1].toLowerCase() : null;
}

function detectCodec(text = "") {
  const normalized = String(text).toLowerCase().replace(/[._-]+/g, " ");
  if (/\b(?:av1)\b/.test(normalized)) return "AV1";
  if (/\b(?:hevc|h ?265|x265)\b/.test(normalized)) return "HEVC";
  if (/\b(?:avc|h ?264|x264)\b/.test(normalized)) return "H.264";
  return null;
}

function detectHdr(text = "") {
  const normalized = String(text).toLowerCase().replace(/[._-]+/g, " ");
  if (/\bdolby\s+vision\b|\bdv\b/.test(normalized)) return "Dolby Vision";
  if (/\bhdr10\+?\b|\bhdr\b/.test(normalized)) return "HDR";
  return null;
}

export function parseSeeders(text = "") {
  const match = String(text).match(/(?:👤|seeders?|peers?)\s*[:=]?\s*(\d[\d,]*)/iu);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function is1337x(text = "") {
  return /(?:^|[^a-z0-9])1337x(?:$|[^a-z0-9])/i.test(String(text));
}

function detectAudio(text = "") {
  const normalized = String(text).toLowerCase().replace(/[._-]+/g, " ");
  const dualAudio = /\bdual\s+audio\b|\bdual\s+audio\b/.test(normalized);
  const englishDub = /\b(?:english|eng)\s+(?:dub|dubbed)\b|\b(?:dub|dubbed)\s+(?:english|eng)\b/.test(normalized);
  if (dualAudio) return "dual-audio";
  if (englishDub) return "english-dubbed";
  return null;
}

function detectReleaseType(text = "") {
  const normalized = String(text).toLowerCase().replace(/[._-]+/g, " ");
  if (/\bweb\s*dl\b|\bwebdl\b|\bweb rip\b/.test(normalized)) return "WEB-DL";
  if (/\bblu\s*ray\b|\bbluray\b|\bbdrip\b/.test(normalized)) return "BluRay";
  if (/\bhdtv\b/.test(normalized)) return "HDTV";
  return null;
}

function detectReleaseGroup(text = "") {
  const match = String(text).match(/^\s*\[([^\]]{2,40})\]/);
  return match ? match[1].trim() : null;
}

function normalizeLink(value) {
  if (!value) return null;

  try {
    const url = new URL(String(value));
    return ["http:", "https:", "magnet:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildMagnet(infoHash, { filename, fileIdx, sources = [], includeTrackers = true, fallbackTrackers = [] }) {
  const params = new URLSearchParams({ xt: `urn:btih:${infoHash}` });
  const displayName = String(filename || "").trim();
  if (displayName) params.set("dn", displayName);
  if (Number.isInteger(fileIdx) && fileIdx >= 0) params.set("so", String(fileIdx));

  if (includeTrackers) {
    const trackers = sources
      .filter(source => typeof source === "string" && source.startsWith("tracker:"))
      .map(source => source.slice("tracker:".length).trim())
      .filter(Boolean);
    for (const tracker of trackers.length ? trackers : fallbackTrackers) params.append("tr", tracker);
  }

  return `magnet:?${params.toString()}`;
}

export function normalizeStream(stream = {}) {
  const title = stream.title || "";
  const description = stream.description || "";
  const filename = stream.behaviorHints?.filename || "";
  const searchableText = [title, description, filename].join(" ");
  const infoHash = String(stream.infoHash || "");

  if (!HASH_REGEX.test(infoHash)) return null;

  const parsedSize = parseSize(searchableText);
  const structuredSize = Number.isFinite(stream.size) && stream.size > 0 ? stream.size : null;
  const sizeBytes = structuredSize ?? parsedSize;
  const normalizedHash = infoHash.toLowerCase();
  const fileIdx = Number.isInteger(stream.fileIdx) && stream.fileIdx >= 0 ? stream.fileIdx : null;
  const sources = Array.isArray(stream.sources) ? stream.sources.filter(item => typeof item === "string") : [];
  const filenameValue = filename || title || "1080p source";
  const sourceTrackers = sources.filter(item => item.startsWith("tracker:"));
  const fallbackTrackersUsed = sourceTrackers.length === 0;
  const magnetOptions = { filename: filenameValue, fileIdx, sources, fallbackTrackers: FALLBACK_TRACKERS };
  const provider = String([stream.name, searchableText].filter(Boolean).join(" ")).match(/1337x/i) ? "1337x" : null;
  const seeders = Number.isFinite(stream.seeders) && stream.seeders >= 0
    ? stream.seeders
    : parseSeeders(searchableText);

  return {
    name: stream.name || "Torrentio",
    title: title || filename || "1080p source",
    description,
    infoHash: normalizedHash,
    fileIdx,
    filename: filename || null,
    sizeBytes,
    sizeLabel: formatSize(sizeBytes),
    provider,
    seeders,
    preferredProvider: is1337x(searchableText),
    sourceUrl: normalizeLink(stream.url),
    externalUrl: normalizeLink(stream.externalUrl),
    trackerCount: sourceTrackers.length,
    fallbackTrackersUsed,
    magnet: buildMagnet(normalizedHash, magnetOptions),
    rawMagnet: buildMagnet(normalizedHash, { ...magnetOptions, includeTrackers: false }),
    resolution: detectResolution(searchableText),
    codec: detectCodec(searchableText),
    hdr: detectHdr(searchableText),
    audio: detectAudio(searchableText),
    audioEvidence: detectAudio(searchableText) === "english-dubbed"
      ? "explicit-english-dub"
      : /\bdual\s+audio\b/i.test(searchableText) ? "possible-english-audio" : "unverified",
    releaseType: detectReleaseType(searchableText),
    releaseGroup: detectReleaseGroup(searchableText),
    metadataCompleteness: [sizeBytes, seeders, fileIdx, detectResolution(searchableText), detectCodec(searchableText), detectReleaseType(searchableText), detectReleaseGroup(searchableText)].filter(value => value !== null && value !== undefined).length
  };
}

export function selectBestSource(streams = [], preference = "default", audioMode = "any", filters = {}) {
  const normalized = streams.map(normalizeStream).filter(Boolean);
  const requestedResolution = filters.resolution || "1080p";
  const candidates = normalized.filter(candidate => {
    if (requestedResolution !== "any" && candidate.resolution !== requestedResolution) return false;
    if (Number.isFinite(filters.maxSizeBytes) && (candidate.sizeBytes === null || candidate.sizeBytes > filters.maxSizeBytes)) return false;
    if (Number.isFinite(filters.minSeeders) && (candidate.seeders === null || candidate.seeders < filters.minSeeders)) return false;
    if (filters.codec && candidate.codec !== filters.codec) return false;
    if (filters.hdr && candidate.hdr !== filters.hdr) return false;
    return true;
  }).filter(candidate => audioMode === "any"
    || (audioMode === "english-dubbed-only" && candidate.audio === "english-dubbed")
    || (audioMode === "english-dubbed-or-dual" && (candidate.audio === "english-dubbed" || candidate.audio === "dual-audio")));
  const aliases = { "best-overall": "balanced", "smallest-acceptable": "smallest", "most-reliable": "seeders" };
  const mode = ["default", "smallest", "seeders", "1337x", "balanced", "quality"].includes(aliases[preference] || preference) ? (aliases[preference] || preference) : "default";
  const qualityScore = candidate => (candidate.resolution === "2160p" ? 4 : candidate.resolution === "1440p" ? 3 : candidate.resolution === "1080p" ? 2 : candidate.resolution === "720p" ? 1 : 0) + (candidate.hdr ? 0.35 : 0) + (candidate.codec === "HEVC" || candidate.codec === "AV1" ? 0.2 : 0);

  candidates.sort((a, b) => {
    const compareSeeders = () => {
      if (a.seeders === null && b.seeders !== null) return 1;
      if (a.seeders !== null && b.seeders === null) return -1;
      if (a.seeders !== b.seeders) return (b.seeders ?? -1) - (a.seeders ?? -1);
      return 0;
    };
    if (mode === "quality" || mode === "balanced") {
      const qualityOrder = qualityScore(b) - qualityScore(a);
      if (qualityOrder) return qualityOrder;
      if (mode === "quality") return compareSeeders() || Number(b.preferredProvider) - Number(a.preferredProvider);
    }
    if (mode === "balanced") {
      const sizeScore = candidate => candidate.sizeBytes === null ? 0 : 1 / Math.max(candidate.sizeBytes, 1);
      const seederScore = candidate => candidate.seeders === null ? 0 : Math.log10(candidate.seeders + 1);
      const score = candidate => qualityScore(candidate) * 0.35 + sizeScore(candidate) * 1e9 * 0.30 + seederScore(candidate) * 0.25 + (candidate.preferredProvider ? 0.1 : 0);
      const balancedOrder = score(b) - score(a);
      if (balancedOrder) return balancedOrder;
    }
    if (mode === "1337x" && a.preferredProvider !== b.preferredProvider) {
      return Number(b.preferredProvider) - Number(a.preferredProvider);
    }
    if (mode === "seeders") {
      const seederOrder = compareSeeders();
      if (seederOrder) return seederOrder;
    }
    if (a.sizeBytes === null && b.sizeBytes === null) {
      const seederOrder = compareSeeders();
      if (seederOrder) return seederOrder;
      return Number(b.preferredProvider) - Number(a.preferredProvider);
    }
    if (a.sizeBytes === null) return 1;
    if (b.sizeBytes === null) return -1;
    if (a.sizeBytes !== b.sizeBytes) return a.sizeBytes - b.sizeBytes;
    if (mode !== "seeders") {
      const seederOrder = compareSeeders();
      if (seederOrder) return seederOrder;
    }
    return Number(b.preferredProvider) - Number(a.preferredProvider);
  });

  const selected = candidates[0] || null;
  const selectionReason = selected ? [
    selected.resolution ? `${selected.resolution} requirement` : "available resolution metadata",
    selected.sizeBytes === null ? "size unknown" : `${selected.sizeLabel} known size`,
    selected.seeders === null ? "seeder count unknown" : `${selected.seeders} seeders`,
    selected.audioEvidence === "explicit-english-dub" ? "explicit English Dub metadata" : selected.audioEvidence === "possible-english-audio" ? "possible English audio metadata" : "audio language unverified"
  ].join(", ") : "No source met the active hard filters.";

  return {
    selected,
    candidates,
    selectionReason,
    status: !selected ? "unavailable" : selected.sizeBytes === null ? "size-unknown" : "selected"
  };
}
