export const MANGADEX_SOURCE_ID = "mangadex";
export const MANGADEX_TIMEOUT_MS = 15_000;
export const MAX_MANGADEX_IMAGE_BYTES = 4 * 1024 * 1024;
export const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif"
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COVER_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.(?:jpg|jpeg|png|webp)$/i;
const VALID_QUALITIES = new Set(["data-saver", "data"]);
const ALLOWED_LANGUAGES = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const AT_HOME_CACHE_TTL_MS = 10 * 60 * 1000;
const AT_HOME_CACHE_MAX_ENTRIES = 100;
const COVER_PALETTE = ["#51447e", "#536d60", "#765142", "#475c7a", "#6e4b66"];

const atHomeCache = new Map();

function getBaseUrl() {
  return (process.env.MANGADEX_BASE_URL || "https://api.mangadex.org").replace(/\/+$/, "");
}

function getUploadsUrl() {
  return (process.env.MANGADEX_UPLOADS_URL || "https://uploads.mangadex.org").replace(/\/+$/, "");
}

function getUserAgent() {
  return (process.env.MANGADEX_USER_AGENT || "SeasonFetch/1.1 (+https://github.com/rightcodes1/SeasonFetch)").trim();
}

export function clearMangaDexCache() {
  atHomeCache.clear();
}

export function isValidUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidCoverFileName(value) {
  return typeof value === "string" && !value.includes("..") && COVER_FILE_PATTERN.test(value);
}

function httpError(message, statusCode, extras = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extras);
  return error;
}

export function isAllowedAtHomeBaseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return false;
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  if (parsed.pathname && parsed.pathname !== "/") return false;

  const configuredOrigin = (() => {
    try { return new URL(getBaseUrl()).origin; } catch { return ""; }
  })();
  if (configuredOrigin && parsed.origin === configuredOrigin) return true;

  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host === "mangadex.org" || host.endsWith(".mangadex.org") || host.endsWith(".mangadex.network");
}

function sanitizeExternalUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
  } catch {
    return null;
  }
  return null;
}

function pickLocalizedText(record, preferred = ["en", "ja-ro", "ko-ro", "zh-ro"]) {
  if (!record || typeof record !== "object") return "";
  for (const key of preferred) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickWorkTitle(attributes = {}) {
  const directEn = attributes.title?.en;
  if (typeof directEn === "string" && directEn.trim()) return directEn.trim();
  if (Array.isArray(attributes.altTitles)) {
    const altEn = attributes.altTitles.find(entry => typeof entry?.en === "string" && entry.en.trim());
    if (altEn) return altEn.en.trim();
  }
  return pickLocalizedText(attributes.title) || "Untitled manga";
}

function collectAlternateTitles(attributes = {}, primaryTitle = "") {
  const seen = new Set([primaryTitle.toLowerCase()]);
  const list = [];
  const push = value => {
    const clean = typeof value === "string" ? value.trim() : "";
    if (!clean || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    list.push(clean);
  };
  if (attributes.title && typeof attributes.title === "object") {
    Object.values(attributes.title).forEach(push);
  }
  if (Array.isArray(attributes.altTitles)) {
    for (const entry of attributes.altTitles) {
      if (entry && typeof entry === "object") Object.values(entry).forEach(push);
    }
  }
  return list.slice(0, 6);
}

function coverColorForId(id = "") {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_PALETTE[hash % COVER_PALETTE.length];
}

function normalizeStatus(status) {
  if (["ongoing", "completed", "hiatus"].includes(status)) return status;
  return "unknown";
}

function normalizeWork(item = {}) {
  const attributes = item.attributes || {};
  const relationships = Array.isArray(item.relationships) ? item.relationships : [];
  const title = pickWorkTitle(attributes);
  const authorRel = relationships.find(rel => rel?.type === "author" && rel?.attributes?.name);
  const artistRel = relationships.find(rel => rel?.type === "artist" && rel?.attributes?.name);
  const coverRel = relationships.find(rel => rel?.type === "cover_art" && rel?.attributes?.fileName);
  const coverFileName = coverRel?.attributes?.fileName;
  const coverUrl = isValidUuid(item.id) && isValidCoverFileName(coverFileName)
    ? `/api/manga/mangadex/cover/${encodeURIComponent(item.id)}/${encodeURIComponent(coverFileName)}`
    : null;
  const genres = Array.isArray(attributes.tags)
    ? attributes.tags
        .filter(tag => ["genre", "theme"].includes(tag?.attributes?.group))
        .map(tag => pickLocalizedText(tag?.attributes?.name))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    id: item.id,
    sourceId: MANGADEX_SOURCE_ID,
    title,
    alternateTitles: collectAlternateTitles(attributes, title),
    description: pickLocalizedText(attributes.description),
    author: authorRel?.attributes?.name || undefined,
    artist: artistRel?.attributes?.name || undefined,
    status: normalizeStatus(attributes.status),
    genres,
    year: Number.isInteger(attributes.year) ? attributes.year : undefined,
    coverColor: coverColorForId(item.id),
    coverUrl,
    externalUrl: isValidUuid(item.id) ? `https://mangadex.org/title/${item.id}` : null
  };
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeChapter(item = {}, workId = "") {
  const attributes = item.attributes || {};
  const relationships = Array.isArray(item.relationships) ? item.relationships : [];
  const groupRel = relationships.find(rel => rel?.type === "scanlation_group" && rel?.attributes?.name);
  const groupName = groupRel?.attributes?.name || "MangaDex community";
  const groupId = groupRel?.id || "mangadex-community";
  const number = parseOptionalNumber(attributes.chapter);
  const volumeNumber = parseOptionalNumber(attributes.volume);
  const pageCount = Number.isInteger(attributes.pages) && attributes.pages >= 0 ? attributes.pages : 0;
  const externalUrl = sanitizeExternalUrl(attributes.externalUrl);
  const readableInline = Boolean(pageCount > 0 && !externalUrl);
  const language = String(attributes.translatedLanguage || "en");

  return {
    id: item.id,
    sourceId: MANGADEX_SOURCE_ID,
    workId,
    volumeId: volumeNumber == null ? undefined : `${workId}:vol:${volumeNumber}`,
    volumeNumber,
    number,
    title: typeof attributes.title === "string" && attributes.title.trim()
      ? attributes.title.trim()
      : number == null ? "Oneshot / Special" : `Chapter ${number}`,
    language,
    readingSource: {
      id: `mangadex-group:${groupId}`,
      name: groupName,
      language,
      workId,
      chapterIds: [item.id]
    },
    pageCount,
    publishedAt: attributes.publishAt || attributes.readableAt || undefined,
    externalUrl,
    readableInline
  };
}

function guessMimeType(fileName = "") {
  const lower = String(fileName).toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}

function extractRetryAfter(response) {
  const raw = response.headers.get("retry-after") || response.headers.get("x-ratelimit-retry-after");
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  return trimmed ? trimmed.slice(0, 64) : undefined;
}

function isRedirectFetchError(error) {
  const msg = String(error?.message || "");
  const causeMsg = String(error?.cause?.message || "");
  return error?.cause?.code === "ERR_REDIRECT"
    || /redirect/i.test(msg)
    || /redirect/i.test(causeMsg);
}

async function readBoundedBuffer(response, maxBytes) {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null && contentLengthHeader !== "") {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel?.().catch(() => {});
      throw httpError("MangaDex image exceeds maximum allowed size.", 502);
    }
  }

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.byteLength) continue;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          throw httpError("MangaDex image exceeds maximum allowed size.", 502);
        }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, totalBytes);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw httpError("MangaDex image exceeds maximum allowed size.", 502);
  }
  return buffer;
}

async function requestJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": getUserAgent()
      },
      redirect: "error",
      signal: AbortSignal.timeout(MANGADEX_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw httpError("MangaDex request timed out.", 504);
    if (isRedirectFetchError(error)) throw httpError("Upstream MangaDex redirects are not allowed.", 502);
    throw httpError("MangaDex request failed.", 502);
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel?.().catch(() => {});
    throw httpError("Upstream MangaDex redirects are not allowed.", 502);
  }

  if (!response.ok) {
    if (response.status === 404) throw httpError("MangaDex resource not found.", 404);
    if (response.status === 429) {
      throw httpError("MangaDex rate limit reached. Try again shortly.", 429, { retryAfter: extractRetryAfter(response) });
    }
    throw httpError(`MangaDex returned HTTP ${response.status}.`, 502);
  }

  return response.json();
}

async function requestImage(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "image/jpeg,image/png,image/webp,image/gif,image/avif",
        "User-Agent": getUserAgent()
      },
      redirect: "error",
      signal: AbortSignal.timeout(MANGADEX_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw httpError("MangaDex image request timed out.", 504, { retryableNodeFailure: true });
    }
    if (isRedirectFetchError(error)) {
      throw httpError("Upstream MangaDex redirects are not allowed.", 502);
    }
    throw httpError("MangaDex image request failed.", 502, { retryableNodeFailure: true });
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel?.().catch(() => {});
    throw httpError("Upstream MangaDex redirects are not allowed.", 502);
  }

  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    if (response.status === 404 || response.status === 410) {
      throw httpError("MangaDex image not found.", response.status === 410 ? 404 : response.status, { retryableNodeFailure: true });
    }
    if (response.status === 429) {
      throw httpError("MangaDex rate limit reached. Try again shortly.", 429, { retryAfter: extractRetryAfter(response) });
    }
    throw httpError(`MangaDex image server returned HTTP ${response.status}.`, 502, {
      retryableNodeFailure: response.status >= 500
    });
  }

  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    await response.body?.cancel?.().catch(() => {});
    throw httpError("Unsupported MangaDex image content type.", 502);
  }

  const buffer = await readBoundedBuffer(response, MAX_MANGADEX_IMAGE_BYTES);
  if (!buffer.length) throw httpError("Upstream MangaDex returned an empty image.", 502, { retryableNodeFailure: true });
  return { buffer, contentType };
}

function getCachedAtHome(chapterId) {
  const entry = atHomeCache.get(chapterId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= AT_HOME_CACHE_TTL_MS) {
    atHomeCache.delete(chapterId);
    return null;
  }
  return entry;
}

function setCachedAtHome(chapterId, entry) {
  if (atHomeCache.size >= AT_HOME_CACHE_MAX_ENTRIES) {
    const oldestKey = atHomeCache.keys().next().value;
    if (oldestKey) atHomeCache.delete(oldestKey);
  }
  atHomeCache.set(chapterId, entry);
}

async function resolveAtHome(chapterId, { forceRefresh = false } = {}) {
  if (!isValidUuid(chapterId)) throw httpError("Invalid MangaDex chapter ID.", 400);
  if (!forceRefresh) {
    const cached = getCachedAtHome(chapterId);
    if (cached) return { entry: cached, fromCache: true };
  }

  const payload = await requestJson(`${getBaseUrl()}/at-home/server/${encodeURIComponent(chapterId)}`);
  const rawBaseUrl = String(payload?.baseUrl || "").trim();
  if (!isAllowedAtHomeBaseUrl(rawBaseUrl)) {
    throw httpError("MangaDex returned an invalid chapter image server response.", 502);
  }
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const hash = String(payload?.chapter?.hash || "").trim();
  const data = Array.isArray(payload?.chapter?.data) ? payload.chapter.data.filter(item => typeof item === "string" && item.trim()) : [];
  const dataSaver = Array.isArray(payload?.chapter?.dataSaver) ? payload.chapter.dataSaver.filter(item => typeof item === "string" && item.trim()) : [];

  if (!hash) {
    throw httpError("MangaDex returned an invalid chapter image server response.", 502);
  }

  const entry = { baseUrl, hash, data, dataSaver, cachedAt: Date.now() };
  setCachedAtHome(chapterId, entry);
  return { entry, fromCache: false };
}

export async function searchManga(query = "", { limit = 20, language = "en" } = {}) {
  const cleanQuery = String(query || "").trim().slice(0, 120);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 30);
  const safeLanguage = ALLOWED_LANGUAGES.test(String(language || "")) ? String(language) : "en";

  const params = new URLSearchParams();
  params.set("limit", String(safeLimit));
  params.append("includes[]", "cover_art");
  params.append("includes[]", "author");
  params.append("includes[]", "artist");
  params.append("contentRating[]", "safe");
  params.append("contentRating[]", "suggestive");

  if (cleanQuery) {
    params.set("title", cleanQuery);
    params.set("order[relevance]", "desc");
  } else {
    params.set("hasAvailableChapters", "true");
    params.append("availableTranslatedLanguage[]", safeLanguage);
    params.set("order[followedCount]", "desc");
  }

  const payload = await requestJson(`${getBaseUrl()}/manga?${params.toString()}`);
  return (Array.isArray(payload?.data) ? payload.data : []).map(normalizeWork);
}

export async function getMangaDetails(workId) {
  if (!isValidUuid(workId)) throw httpError("Invalid MangaDex manga ID.", 400);
  const params = new URLSearchParams();
  params.append("includes[]", "cover_art");
  params.append("includes[]", "author");
  params.append("includes[]", "artist");
  const payload = await requestJson(`${getBaseUrl()}/manga/${encodeURIComponent(workId)}?${params.toString()}`);
  if (!payload?.data) throw httpError("Manga not found.", 404);
  return normalizeWork(payload.data);
}

export async function getMangaChapters(workId, { language = "en", maxChapters = 300 } = {}) {
  if (!isValidUuid(workId)) throw httpError("Invalid MangaDex manga ID.", 400);
  const safeLanguage = ALLOWED_LANGUAGES.test(String(language || "")) ? String(language) : "en";
  const pageSize = 100;
  const cap = Math.min(Math.max(Number(maxChapters) || 300, 1), 500);

  const collected = [];
  let offset = 0;
  let total = 0;
  while (collected.length < cap) {
    const batchLimit = Math.min(pageSize, cap - collected.length);
    const params = new URLSearchParams();
    params.set("limit", String(batchLimit));
    params.set("offset", String(offset));
    params.append("translatedLanguage[]", safeLanguage);
    params.append("includes[]", "scanlation_group");
    params.append("contentRating[]", "safe");
    params.append("contentRating[]", "suggestive");
    params.set("order[volume]", "asc");
    params.set("order[chapter]", "asc");

    const payload = await requestJson(`${getBaseUrl()}/manga/${encodeURIComponent(workId)}/feed?${params.toString()}`);
    const batch = Array.isArray(payload?.data) ? payload.data : [];
    for (const item of batch) collected.push(normalizeChapter(item, workId));

    const reportedTotal = Number(payload?.total);
    total = Number.isFinite(reportedTotal) && reportedTotal >= collected.length ? reportedTotal : collected.length;
    if (batch.length === 0 || batch.length < batchLimit || collected.length >= total) break;
    offset += batch.length;
  }

  return {
    chapters: collected,
    total,
    truncated: total > collected.length
  };
}

export async function getChapterPages(chapterId, { quality = "data-saver" } = {}) {
  if (!VALID_QUALITIES.has(quality)) throw httpError("Quality must be data-saver or data.", 400);
  const { entry: atHome } = await resolveAtHome(chapterId);
  const effectiveQuality = quality === "data-saver" && atHome.dataSaver.length ? "data-saver" : "data";
  const files = effectiveQuality === "data-saver" ? atHome.dataSaver : atHome.data;

  return files.map((fileName, index) => ({
    id: `${chapterId}:page:${index}`,
    sourceId: MANGADEX_SOURCE_ID,
    chapterId,
    index,
    label: `Page ${index + 1}`,
    mimeType: guessMimeType(fileName),
    imageUrl: `/api/manga/mangadex/page/${encodeURIComponent(chapterId)}/${effectiveQuality}/${index}`
  }));
}

function buildAtHomePageUrl(atHome, quality, index) {
  const files = quality === "data-saver" ? atHome.dataSaver : atHome.data;
  const fileName = files[index];
  if (!fileName) throw httpError("Chapter page not found.", 404);
  const pathSegment = quality === "data-saver" ? "data-saver" : "data";
  return `${atHome.baseUrl}/${pathSegment}/${encodeURIComponent(atHome.hash)}/${encodeURIComponent(fileName)}`;
}

export async function fetchChapterPageImage(chapterId, quality, pageIndex) {
  if (!isValidUuid(chapterId)) throw httpError("Invalid MangaDex chapter ID.", 400);
  if (!VALID_QUALITIES.has(quality)) throw httpError("Quality must be data-saver or data.", 400);
  const index = Number(pageIndex);
  if (!Number.isInteger(index) || index < 0) throw httpError("Invalid page index.", 400);

  const { entry: atHome, fromCache } = await resolveAtHome(chapterId);
  const imageUrl = buildAtHomePageUrl(atHome, quality, index);

  try {
    return await requestImage(imageUrl);
  } catch (error) {
    if (!error?.retryableNodeFailure) throw error;
    atHomeCache.delete(chapterId);
    if (!fromCache) throw error;

    const { entry: refreshed } = await resolveAtHome(chapterId, { forceRefresh: true });
    const refreshedUrl = buildAtHomePageUrl(refreshed, quality, index);
    try {
      return await requestImage(refreshedUrl);
    } catch (retryError) {
      if (retryError?.retryableNodeFailure) atHomeCache.delete(chapterId);
      throw retryError;
    }
  }
}

export async function fetchCoverImage(mangaId, fileName) {
  if (!isValidUuid(mangaId)) throw httpError("Invalid MangaDex manga ID.", 400);
  if (!isValidCoverFileName(fileName)) throw httpError("Invalid MangaDex cover file name.", 400);

  const uploadsUrl = getUploadsUrl();
  const thumbUrl = `${uploadsUrl}/covers/${encodeURIComponent(mangaId)}/${encodeURIComponent(fileName)}.256.jpg`;
  try {
    return await requestImage(thumbUrl);
  } catch (error) {
    if (error?.statusCode !== 404) throw error;
    const originalUrl = `${uploadsUrl}/covers/${encodeURIComponent(mangaId)}/${encodeURIComponent(fileName)}`;
    return requestImage(originalUrl);
  }
}
