import express from "express";
import { getBearerToken, supabaseRequest, supabaseRpc, verifySupabaseToken } from "../services/supabaseAuth.js";

function createAccountRateLimiter({ maxRequests = 60, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return function limitAccount(req, res, next) {
    const key = req.ip || req.headers["x-forwarded-for"] || "unknown";
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
      return res.status(429).json({ error: "Too many account requests. Please try again in a minute." });
    }
    recent.push(now);
    buckets.set(key, recent);
    return next();
  };
}

export function createAccountRouter({
  verifyToken = verifySupabaseToken,
  request = supabaseRequest,
  rpc = supabaseRpc
} = {}) {
  const router = express.Router();
  const limitAccount = createAccountRateLimiter();

  router.get("/account/session", limitAccount, async (req, res) => {
    const token = getBearerToken(req);
    let user;
    try {
      user = await verifyToken(token);
      if (!user?.sub) throw new Error("Invalid Supabase access token.");
    } catch {
      return res.status(401).json({ error: "A valid Supabase access token is required." });
    }

    try {
      const suspensionRows = await request(
        `account_suspensions?select=suspended,reason&user_id=eq.${encodeURIComponent(user.sub)}&limit=1`,
        token
      );
      const suspension = Array.isArray(suspensionRows) ? suspensionRows[0] || null : null;
      if (suspension?.suspended === true) {
        return res.json({
          authenticated: true,
          userId: user.sub,
          active: false,
          suspended: true,
          suspensionReason: String(suspension.reason || ""),
          isAdmin: false,
          profile: null
        });
      }

      const [profileRows, isAdminResult] = await Promise.all([
        request(
          `profiles?select=id,username,display_name,bio,avatar_path,avatar_frame,accent_color,is_public,created_at,updated_at&id=eq.${encodeURIComponent(user.sub)}&limit=1`,
          token
        ),
        rpc("is_admin", {}, token).catch(() => false)
      ]);

      return res.json({
        authenticated: true,
        userId: user.sub,
        active: true,
        suspended: false,
        suspensionReason: "",
        isAdmin: isAdminResult === true,
        profile: Array.isArray(profileRows) ? profileRows[0] || null : null
      });
    } catch (error) {
      console.error("Account session verification failed:", error.message);
      return res.status(503).json({ error: "Unable to verify account status. Please try again shortly." });
    }
  });

  return router;
}
