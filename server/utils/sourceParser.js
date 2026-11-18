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

const ENGLISH_DUB_PATTERNS = [
  /\b(?:eng(?:lish)?[\s._-]*(?:dub(?:bed)?|audio)|(?:dub(?:bed)?|audio)[\s._-]*(?:eng|english))\b/i,
  /\bdubbed?\s+in\s+english\b/i,
  /\bdual[\s._-]*audio\b(?=[\s\S]{0,100}(?:\beng(?:lish)?\b|🇬🇧|🇺🇸|🇨🇦|🇦🇺|🇳🇿))|(?:\beng(?:lish)?\b|🇬🇧|🇺🇸|🇨🇦|🇦🇺|🇳🇿)[\s\S]{0,100}\bdual[\s._-]*audio\b/i
];

export function hasEnglishDub(text = "") {
  const value = String(text);
  const negative = /\b(?:no|not|without|non)[\s._-]+(?:(?:english|eng)[\s._-]*(?:dub(?:bed)?|audio)|dual[\s._-]*audio)\b/i;
  if (negative.test(value)) return false;
  return ENGLISH_DUB_PATTERNS.some(pattern => pattern.test(value));
}

export function parseSeeders(text = "") {
  const match = String(text).match(/(?:👤|seeders?|peers?)\s*[:=]?\s*(\d[\d,]*)/iu);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function is1337x(text = "") {
  return /(?:^|[^a-z0-9])1337x(?:$|[^a-z0-9])/i.test(String(text));
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
  const englishDub = hasEnglishDub(searchableText);
  const languageLabel = /\bdual[\s._-]*audio\b/i.test(searchableText) && hasEnglishDub(searchableText)
    ? "Dual Audio"
    : englishDub ? "English Dub" : null;
  const infoHash = String(stream.infoHash || "");

  if (!HASH_REGEX.test(infoHash) || !has1080p(searchableText)) return null;

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
    resolution: "1080p",
    englishDub,
    languageLabel
  };
}

export function selectBestSource(streams = [], preference = "default", { englishDubOnly = false } = {}) {
  const candidates = streams
    .map(normalizeStream)
    .filter(Boolean)
    .filter(source => !englishDubOnly || source.englishDub);
  const mode = ["default", "smallest", "seeders", "1337x"].includes(preference) ? preference : "default";

  candidates.sort((a, b) => {
    if (mode === "1337x" && a.preferredProvider !== b.preferredProvider) {
      return Number(b.preferredProvider) - Number(a.preferredProvider);
    }
    if (mode === "seeders") {
      if (a.seeders === null && b.seeders !== null) return 1;
      if (a.seeders !== null && b.seeders === null) return -1;
      if (a.seeders !== b.seeders) return b.seeders - a.seeders;
    }
    if (a.sizeBytes === null && b.sizeBytes === null) return 0;
    if (a.sizeBytes === null) return 1;
    if (b.sizeBytes === null) return -1;
    if (a.sizeBytes !== b.sizeBytes) return a.sizeBytes - b.sizeBytes;
    if (mode !== "seeders") {
      if (a.seeders === null && b.seeders !== null) return 1;
      if (a.seeders !== null && b.seeders === null) return -1;
      if (a.seeders !== b.seeders) return b.seeders - a.seeders;
    }
    return Number(b.preferredProvider) - Number(a.preferredProvider);
  });

  const selected = candidates[0] || null;

  return {
    selected,
    candidates,
    status: !selected ? "unavailable" : selected.sizeBytes === null ? "size-unknown" : "selected"
  };
}
