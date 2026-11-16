const HASH_REGEX = /^[a-fA-F0-9]{40}$/;

const SIZE_UNITS = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4
};

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

function normalizeLink(value) {
  if (!value) return null;

  try {
    const url = new URL(String(value));
    return ["http:", "https:", "magnet:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildMagnet(infoHash, { filename, fileIdx, sources = [] }) {
  const params = new URLSearchParams({ xt: `urn:btih:${infoHash}` });
  const displayName = String(filename || "").trim();
  if (displayName) params.set("dn", displayName);
  if (Number.isInteger(fileIdx) && fileIdx >= 0) params.set("so", String(fileIdx));

  for (const source of sources) {
    if (typeof source !== "string" || !source.startsWith("tracker:")) continue;
    const tracker = source.slice("tracker:".length).trim();
    if (tracker) params.append("tr", tracker);
  }

  return `magnet:?${params.toString()}`;
}

export function normalizeStream(stream = {}) {
  const title = stream.title || "";
  const description = stream.description || "";
  const filename = stream.behaviorHints?.filename || "";
  const searchableText = [title, description, filename].join(" ");
  const infoHash = String(stream.infoHash || "");

  if (!HASH_REGEX.test(infoHash) || !has1080p(searchableText)) return null;

  const parsedSize = parseSize(searchableText);
  const structuredSize = Number.isFinite(stream.size) && stream.size > 0 ? stream.size : null;
  const sizeBytes = structuredSize ?? parsedSize;
  const normalizedHash = infoHash.toLowerCase();
  const fileIdx = Number.isInteger(stream.fileIdx) && stream.fileIdx >= 0 ? stream.fileIdx : null;
  const sources = Array.isArray(stream.sources) ? stream.sources.filter(item => typeof item === "string") : [];
  const filenameValue = filename || title || "1080p source";

  return {
    name: stream.name || "Torrentio",
    title: title || filename || "1080p source",
    description,
    infoHash: normalizedHash,
    fileIdx,
    filename: filename || null,
    sizeBytes,
    sizeLabel: formatSize(sizeBytes),
    sourceUrl: normalizeLink(stream.url),
    externalUrl: normalizeLink(stream.externalUrl),
    trackerCount: sources.filter(item => item.startsWith("tracker:")).length,
    magnet: buildMagnet(normalizedHash, { filename: filenameValue, fileIdx, sources }),
    resolution: "1080p"
  };
}

export function selectBestSource(streams = []) {
  const candidates = streams.map(normalizeStream).filter(Boolean);

  candidates.sort((a, b) => {
    if (a.sizeBytes === null && b.sizeBytes === null) return 0;
    if (a.sizeBytes === null) return 1;
    if (b.sizeBytes === null) return -1;
    return a.sizeBytes - b.sizeBytes;
  });

  const selected = candidates[0] || null;

  return {
    selected,
    candidates,
    status: !selected ? "unavailable" : selected.sizeBytes === null ? "size-unknown" : "selected"
  };
}
