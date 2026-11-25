import express from "express";
import { requireUser } from "../services/supabaseAuth.js";
import { createLibraryService } from "../services/library.js";

function createSlidingWindowLimiter({ maxRequests, windowMs, message }) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const key = req.supabaseUser?.sub || req.ip || req.headers["x-forwarded-for"] || "unknown";
    const now = Date.now();
    if (buckets.size > 2000) {
      for (const [bucketKey, timestamps] of buckets) {
        const fresh = timestamps.filter(ts => now - ts < windowMs);
        if (fresh.length) buckets.set(bucketKey, fresh);
        else buckets.delete(bucketKey);
      }
    }
    const recent = (buckets.get(key) || []).filter(ts => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message });
    }
    recent.push(now);
    buckets.set(key, recent);
    return next();
  };
}

function sendLibraryError(res, error, fallbackMessage) {
  const status = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : Number.isInteger(error?.status)
      ? error.status
      : 502;
  const safeMessage = status >= 400 && status < 500
    ? error.message || fallbackMessage
    : fallbackMessage;
  return res.status(status).json({ error: safeMessage });
}

export function createLibraryRouter({
  requireUserMiddleware = requireUser,
  service = createLibraryService()
} = {}) {
  const router = express.Router();
  const limitLibrary = createSlidingWindowLimiter({
    maxRequests: 120,
    windowMs: 60_000,
    message: "Too many library requests. Please try again in a minute."
  });

  router.get("/library", requireUserMiddleware, limitLibrary, async (req, res) => {
    try {
      const result = await service.listLibraryItems(req.supabaseUser.sub, req.supabaseToken, {
        status: req.query.status ? String(req.query.status) : undefined,
        mediaType: req.query.mediaType ? String(req.query.mediaType) : undefined,
        favorite: req.query.favorite === "true"
      });
      return res.json(result);
    } catch (error) {
      console.error("Library list failed:", error.message);
      return sendLibraryError(res, error, "Unable to load your library right now.");
    }
  });

  router.put("/library/:mediaType/:imdbId", requireUserMiddleware, limitLibrary, async (req, res) => {
    try {
      const result = await service.upsertLibraryItem(req.supabaseUser.sub, req.supabaseToken, {
        mediaType: req.params.mediaType,
        imdbId: req.params.imdbId,
        payload: req.body
      });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      console.error("Library save failed:", error.message);
      return sendLibraryError(res, error, "Unable to save this title to your library.");
    }
  });

  router.patch("/library/:mediaType/:imdbId", requireUserMiddleware, limitLibrary, async (req, res) => {
    try {
      const result = await service.updateLibraryItem(req.supabaseUser.sub, req.supabaseToken, {
        mediaType: req.params.mediaType,
        imdbId: req.params.imdbId,
        patch: req.body
      });
      return res.json(result);
    } catch (error) {
      console.error("Library update failed:", error.message);
      return sendLibraryError(res, error, "Unable to update this library item.");
    }
  });

  router.delete("/library/:mediaType/:imdbId", requireUserMiddleware, limitLibrary, async (req, res) => {
    try {
      const result = await service.removeLibraryItem(req.supabaseUser.sub, req.supabaseToken, {
        mediaType: req.params.mediaType,
        imdbId: req.params.imdbId
      });
      return res.json(result);
    } catch (error) {
      console.error("Library removal failed:", error.message);
      return sendLibraryError(res, error, "Unable to remove this title from your library.");
    }
  });

  router.post("/activity/active-day", requireUserMiddleware, limitLibrary, async (req, res) => {
    try {
      const result = await service.recordActiveDay(req.supabaseUser.sub, req.supabaseToken);
      return res.json(result);
    } catch (error) {
      console.error("Active-day ping failed:", error.message);
      return sendLibraryError(res, error, "Unable to record activity.");
    }
  });

  return router;
}
