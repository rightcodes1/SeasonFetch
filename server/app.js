import "./loadEnv.js";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchCinemeta, getSeries, getMovie } from "./services/cinemeta.js";
import { getSeasonSources, getMovieSources } from "./services/torrentio.js";
import { explainSourceCandidates, geminiStatus, suggestSearchQueries } from "./services/gemini.js";
import { requireUser, supabaseRequest, supabaseRpc } from "./services/supabaseAuth.js";
import {
  fetchChapterPageImage,
  fetchCoverImage,
  getChapterPages,
  getMangaChapters,
  getMangaDetails,
  searchManga
} from "./services/mangadex.js";
import { normalizeRankingPreference } from "../shared/rankingPreferences.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const app = express();
const port = Number(process.env.PORT) || 3000;
const allowedOrigins = new Set(
  String(process.env.CLIENT_ORIGIN || "http://localhost:3000")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)
);
const isSeasonFetchVercelOrigin = origin => /^https:\/\/season-fetch(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin);
const geminiRateWindow = new Map();

function createWindowRateLimiter({ maxRequests, windowMs = 60_000, message, maxKeys = 500 }) {
  const buckets = new Map();
  return function rateLimitMiddleware(req, res, next) {
    const key = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const now = Date.now();
    if (buckets.size > maxKeys) {
      for (const [bucketKey, timestamps] of buckets.entries()) {
        if (!timestamps.some(ts => now - ts < windowMs)) buckets.delete(bucketKey);
      }
    }
    const recent = (buckets.get(key) || []).filter(timestamp => now - timestamp < windowMs);
    if (recent.length >= maxRequests) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    recent.push(now);
    buckets.set(key, recent);
    return next();
  };
}

const rateLimitMangaDexMeta = createWindowRateLimiter({
  maxRequests: 60,
  message: "MangaDex API request limit reached. Try again in a minute."
});
const rateLimitMangaDexMedia = createWindowRateLimiter({
  maxRequests: 180,
  message: "MangaDex image request limit reached. Try again in a minute."
});

function sendMangaDexError(res, label, error, fallbackMessage) {
  console.error(`${label}:`, error.message);
  if (error?.retryAfter) res.set("Retry-After", String(error.retryAfter));
  return res.status(error.statusCode || 502).json({ error: error.message || fallbackMessage });
}

function rateLimitGemini(req, res, next) {
  const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const recent = (geminiRateWindow.get(key) || []).filter(timestamp => now - timestamp < 60_000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Gemini request limit reached. Try again in a minute.' });
  recent.push(now);
  geminiRateWindow.set(key, recent);
  return next();
}

app.use(helmet({ frameguard: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin) || isSeasonFetchVercelOrigin(origin)) return callback(null, true);
    const error = new Error("Origin is not allowed by SeasonFetch.");
    error.statusCode = 403;
    error.code = "CORS_ORIGIN_NOT_ALLOWED";
    return callback(error);
  }
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", application: "SeasonFetch", metadata: "Cinemeta", provider: "Torrentio", gemini: geminiStatus().configured ? "configured" : "optional-not-configured" });
});

app.get("/api/gemini/status", (_req, res) => {
  res.json(geminiStatus());
});

async function requireAdmin(req, res, next) {
  try {
    const result = await supabaseRpc("is_admin", {}, req.supabaseToken);
    if (result !== true) return res.status(403).json({ error: "Administrator access required." });
    return next();
  } catch (error) {
    console.error("Admin authorization failed:", error.message);
    return res.status(403).json({ error: "Administrator access required." });
  }
}

app.get("/api/admin/users", requireUser, requireAdmin, async (req, res) => {
  try {
    const profiles = await supabaseRequest("profiles?select=id,username,display_name,bio,is_public,created_at,updated_at&order=created_at.desc", req.supabaseToken);
    const suspensions = await supabaseRequest("account_suspensions?select=user_id,suspended,reason,suspended_by,suspended_at,updated_at", req.supabaseToken);
    const byUser = new Map((suspensions || []).map(item => [item.user_id, item]));
    return res.json({ users: (profiles || []).map(profile => ({ ...profile, suspension: byUser.get(profile.id) || null })) });
  } catch (error) {
    console.error("Admin user directory failed:", error.message);
    return res.status(error.status || 502).json({ error: "Unable to load the user directory." });
  }
});

app.post("/api/admin/users/:userId/suspension", requireUser, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: "Invalid user ID." });
  const shouldSuspend = req.body?.suspended === true;
  try {
    const suspension = await supabaseRpc("admin_set_user_suspension", {
      target_user_id: userId,
      should_suspend: shouldSuspend,
      suspension_reason: String(req.body?.reason || "").slice(0, 500)
    }, req.supabaseToken);
    return res.json({ suspension });
  } catch (error) {
    console.error("Admin suspension action failed:", error.message);
    return res.status(error.status === 42501 ? 403 : error.status || 502).json({ error: error.message || "Unable to update suspension." });
  }
});

app.get("/api/admin/audit-logs", requireUser, requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  try {
    const logs = await supabaseRequest(`audit_logs?select=id,actor_id,action,target_user_id,metadata,created_at&order=created_at.desc&limit=${limit}`, req.supabaseToken);
    return res.json({ logs: logs || [] });
  } catch (error) {
    console.error("Admin audit log lookup failed:", error.message);
    return res.status(error.status || 502).json({ error: "Unable to load audit logs." });
  }
});

app.post("/api/gemini/search-assist", rateLimitGemini, async (req, res) => {
  if (typeof req.body?.query !== "string" || req.body.query.trim().length < 2 || req.body.query.length > 200) {
    return res.status(400).json({ error: "A search query between 2 and 200 characters is required." });
  }
  try {
    return res.json({ queries: await suggestSearchQueries(req.body?.query) });
  } catch (error) {
    console.error("Gemini search assist failed:", error.message);
    return res.status(502).json({ error: "Gemini search assist is unavailable right now." });
  }
});

app.post("/api/gemini/explain-source", rateLimitGemini, async (req, res) => {
  if (!req.body || typeof req.body !== "object" || !Array.isArray(req.body.candidates) || req.body.candidates.length > 50) {
    return res.status(400).json({ error: "A candidate list of up to 50 sources is required." });
  }
  try {
    const result = await explainSourceCandidates(req.body || {});
    return res.json(result);
  } catch (error) {
    console.error("Gemini source explanation failed:", error.message);
    return res.status(502).json({ error: "Gemini is unavailable or returned an invalid response." });
  }
});

app.get("/api/cinemeta/search", async (req, res) => {
  const mediaType = req.query.type === undefined ? "series" : req.query.type;
  if (!["movie", "series"].includes(mediaType)) {
    return res.status(400).json({ error: "Media type must be movie or series." });
  }
  try {
    return res.json({ results: await searchCinemeta(req.query.q, mediaType) });
  } catch (error) {
    console.error("Cinemeta search failed:", error.message);
    return res.status(502).json({ error: "Cinemeta search is unavailable right now." });
  }
});

app.get("/api/cinemeta/movie/:id", async (req, res) => {
  if (!/^tt\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid movie IMDb ID." });
  try {
    return res.json(await getMovie(req.params.id));
  } catch (error) {
    console.error("Cinemeta movie metadata failed:", error.message);
    return res.status(error.statusCode || 502).json({ error: error.statusCode === 404 ? "Movie not found." : error.statusCode === 400 ? "Invalid movie IMDb ID." : "Cinemeta metadata is temporarily unavailable." });
  }
});

app.get("/api/cinemeta/series/:id", async (req, res) => {
  if (!/^tt\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid series IMDb ID." });
  try {
    return res.json(await getSeries(req.params.id));
  } catch (error) {
    console.error("Cinemeta metadata failed:", error.message);
    return res.status(error.statusCode || 502).json({ error: error.statusCode === 404 ? "Series not found." : error.statusCode === 400 ? "Invalid series IMDb ID." : "Cinemeta metadata is temporarily unavailable." });
  }
});

export function parseEpisodeNumbers(value, { numericMeansCount = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw) && numericMeansCount) {
    const count = Number(raw);
    return Number.isInteger(count) && count >= 1 && count <= 30
      ? Array.from({ length: count }, (_, index) => index + 1)
      : null;
  }

  const numbers = raw.split(",").map(item => Number(item.trim()));
  if (!numbers.length || numbers.some(number => !Number.isInteger(number) || number < 1 || number > 200)) return null;
  return [...new Set(numbers)].slice(0, 30);
}

app.get("/api/torrentio/season/:seriesId/:season", async (req, res) => {
  const { seriesId } = req.params;
  const season = Number(req.params.season);
  const explicitEpisodes = req.query.episodeList ?? req.query.episodes;
  const episodeNumbers = req.query.episodeList
    ? parseEpisodeNumbers(explicitEpisodes)
    : parseEpisodeNumbers(explicitEpisodes, { numericMeansCount: true });
  const audioMode = ["any", "english-dubbed-only", "english-dubbed-or-dual"].includes(req.query.audio) ? req.query.audio : "any";
  const preference = normalizeRankingPreference(req.query.preference);
  const resolution = ["any", "480p", "576p", "720p", "1080p", "1440p", "2160p"].includes(req.query.resolution) ? req.query.resolution : "1080p";
  const maxSizeGb = req.query.maxSizeGb === undefined || req.query.maxSizeGb === "" ? null : Number(req.query.maxSizeGb);
  const minSeeders = req.query.minSeeders === undefined || req.query.minSeeders === "" ? null : Number(req.query.minSeeders);
  const codec = ["H.264", "HEVC", "AV1"].includes(req.query.codec) ? req.query.codec : null;
  const hdr = ["HDR", "Dolby Vision"].includes(req.query.hdr) ? req.query.hdr : null;
  if ((maxSizeGb !== null && (!Number.isFinite(maxSizeGb) || maxSizeGb <= 0)) || (minSeeders !== null && (!Number.isInteger(minSeeders) || minSeeders < 0))) {
    return res.status(400).json({ error: "Invalid size or seeder filter." });
  }
  const filters = { resolution, maxSizeBytes: maxSizeGb === null ? null : maxSizeGb * 1024 ** 3, minSeeders, codec, hdr };

  if (!/^tt\d+$/.test(seriesId)) {
    return res.status(400).json({ error: "Invalid series IMDb ID." });
  }

  if (!Number.isInteger(season) || season < 0) {
    return res.status(400).json({ error: "Invalid season number." });
  }

  if (!episodeNumbers) {
    return res.status(400).json({ error: "Episodes must be a count from 1 to 30 or a comma-separated list of episode numbers." });
  }

  try {
    const scan = await getSeasonSources(seriesId, season, episodeNumbers, preference, audioMode, filters);
    return res.json({ provider: "torrentio", seriesId, season, audioMode, preference, filters, totalEpisodes: scan.results.length, ...scan });
  } catch (error) {
    console.error("Torrentio season lookup failed:", error.message);
    return res.status(502).json({ error: "Torrentio is unavailable right now." });
  }
});

app.get("/api/torrentio/movie/:movieId", async (req, res) => {
  const { movieId } = req.params;
  if (!/^tt\d+$/.test(movieId)) return res.status(400).json({ error: "Invalid movie IMDb ID." });

  const audioMode = ["any", "english-dubbed-only", "english-dubbed-or-dual"].includes(req.query.audio) ? req.query.audio : "any";
  const preference = normalizeRankingPreference(req.query.preference);
  const resolution = ["any", "480p", "576p", "720p", "1080p", "1440p", "2160p"].includes(req.query.resolution) ? req.query.resolution : "1080p";
  const maxSizeGb = req.query.maxSizeGb === undefined || req.query.maxSizeGb === "" ? null : Number(req.query.maxSizeGb);
  const minSeeders = req.query.minSeeders === undefined || req.query.minSeeders === "" ? null : Number(req.query.minSeeders);
  const codec = ["H.264", "HEVC", "AV1"].includes(req.query.codec) ? req.query.codec : null;
  const hdr = ["HDR", "Dolby Vision"].includes(req.query.hdr) ? req.query.hdr : null;
  if ((maxSizeGb !== null && (!Number.isFinite(maxSizeGb) || maxSizeGb <= 0)) || (minSeeders !== null && (!Number.isInteger(minSeeders) || minSeeders < 0))) {
    return res.status(400).json({ error: "Invalid size or seeder filter." });
  }
  const filters = { resolution, maxSizeBytes: maxSizeGb === null ? null : maxSizeGb * 1024 ** 3, minSeeders, codec, hdr };

  try {
    const result = await getMovieSources(movieId, preference, audioMode, filters);
    return res.json({ provider: "torrentio", mediaType: "movie", movieId, preference, audioMode, filters, ...result });
  } catch (error) {
    console.error("Torrentio movie lookup failed:", error.message);
    return res.status(502).json({ error: "Torrentio is unavailable right now." });
  }
});

app.get("/api/manga/mangadex/search", rateLimitMangaDexMeta, async (req, res) => {
  try {
    const results = await searchManga(req.query.q, {
      limit: req.query.limit,
      language: req.query.language
    });
    return res.json({ provider: "mangadex", results });
  } catch (error) {
    return sendMangaDexError(res, "MangaDex search failed", error, "MangaDex search is unavailable right now.");
  }
});

app.get("/api/manga/mangadex/work/:workId", rateLimitMangaDexMeta, async (req, res) => {
  try {
    const work = await getMangaDetails(req.params.workId);
    return res.json({ provider: "mangadex", work });
  } catch (error) {
    return sendMangaDexError(res, "MangaDex work lookup failed", error, "MangaDex metadata is unavailable right now.");
  }
});

app.get("/api/manga/mangadex/work/:workId/chapters", rateLimitMangaDexMeta, async (req, res) => {
  try {
    const feed = await getMangaChapters(req.params.workId, {
      language: req.query.language,
      maxChapters: req.query.limit
    });
    return res.json({ provider: "mangadex", chapters: feed.chapters, total: feed.total, truncated: feed.truncated });
  } catch (error) {
    return sendMangaDexError(res, "MangaDex chapter feed failed", error, "MangaDex chapters are unavailable right now.");
  }
});

app.get("/api/manga/mangadex/chapter/:chapterId/pages", rateLimitMangaDexMeta, async (req, res) => {
  const quality = req.query.quality === undefined ? "data-saver" : String(req.query.quality);
  try {
    const pages = await getChapterPages(req.params.chapterId, { quality });
    return res.json({ provider: "mangadex", pages });
  } catch (error) {
    return sendMangaDexError(res, "MangaDex chapter pages failed", error, "MangaDex chapter pages are unavailable right now.");
  }
});

app.get("/api/manga/mangadex/page/:chapterId/:quality/:index", rateLimitMangaDexMedia, async (req, res) => {
  if (!/^\d+$/.test(req.params.index)) {
    return res.status(400).json({ error: "Invalid page index." });
  }
  try {
    const { buffer, contentType } = await fetchChapterPageImage(req.params.chapterId, req.params.quality, Number(req.params.index));
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=3600");
    return res.send(buffer);
  } catch (error) {
    return sendMangaDexError(res, "MangaDex page image proxy failed", error, "MangaDex page image is unavailable.");
  }
});

app.get("/api/manga/mangadex/cover/:mangaId/:fileName", rateLimitMangaDexMedia, async (req, res) => {
  try {
    const { buffer, contentType } = await fetchCoverImage(req.params.mangaId, req.params.fileName);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(buffer);
  } catch (error) {
    return sendMangaDexError(res, "MangaDex cover proxy failed", error, "MangaDex cover image is unavailable.");
  }
});

app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(distDir, "index.html"), error => {
      if (error) next(error);
    });
  }
  return next();
});

app.use((error, _req, res, _next) => {
  if (error?.code === "CORS_ORIGIN_NOT_ALLOWED" && error?.statusCode === 403) {
    return res.status(403).json({ error: error.message });
  }
  console.error("Unhandled server error:", error);
  return res.status(500).json({ error: "Internal server error." });
});

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`SeasonFetch API running on port ${port}`);
  });
}

export default app;
