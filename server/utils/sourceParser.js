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
  const bytes = Math.round(value * SIZE_UNITS[unit]);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
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
  if (!match) return null;
  const seeders = Number(match[1].replace(/,/g, ""));
  return Number.isSafeInteger(seeders) && seeders >= 0 ? seeders : null;
}

function is1337x(text = "") {
  return /(?:^|[^a-z0-9])1337x(?:$|[^a-z0-9])/i.test(String(text));
}

function detectAudio(text = "") {
  const normalized = String(text).toLowerCase().replace(/[._-]+/g, " ");
  const dualAudio = /\bdual\s+audio\b/.test(normalized);
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
  if (!stream || typeof stream !== "object" || Array.isArray(stream)) return null;
  const title = typeof stream.title === "string" ? stream.title : "";
  const description = typeof stream.description === "string" ? stream.description : "";
  const filename = typeof stream.behaviorHints?.filename === "string" ? stream.behaviorHints.filename : "";
  const searchableText = [title, description, filename].join(" ");
  const infoHash = String(stream.infoHash || "");

  if (!HASH_REGEX.test(infoHash)) return null;

  const parsedSize = parseSize(searchableText);
  const structuredSize = Number.isSafeInteger(stream.size) && stream.size > 0 ? stream.size : null;
  const sizeBytes = structuredSize ?? parsedSize;
  const normalizedHash = infoHash.toLowerCase();
  const fileIdx = Number.isSafeInteger(stream.fileIdx) && stream.fileIdx >= 0 ? stream.fileIdx : null;
  const sources = Array.isArray(stream.sources) ? stream.sources.filter(item => typeof item === "string") : [];
  const filenameValue = filename || title || "1080p source";
  const sourceTrackers = sources.filter(item => item.startsWith("tracker:"));
  const fallbackTrackersUsed = sourceTrackers.length === 0;
  const magnetOptions = { filename: filenameValue, fileIdx, sources, fallbackTrackers: FALLBACK_TRACKERS };
  const provider = String([stream.name, searchableText].filter(Boolean).join(" ")).match(/1337x/i) ? "1337x" : null;
  const seeders = Number.isSafeInteger(stream.seeders) && stream.seeders >= 0
    ? stream.seeders
    : parseSeeders(searchableText);

  return {
    name: typeof stream.name === "string" && stream.name.trim() ? stream.name : "Torrentio",
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
