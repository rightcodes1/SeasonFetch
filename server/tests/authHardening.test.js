import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import {
  AUTH_STATUS,
  authReducer,
  createInitialAuthState,
  getRecoveryRedirectUrl,
  isRecoveryStatus,
  normalizeAuthError,
  parseAuthUrlCallback,
  scrubAuthUrl,
  validateNewPassword
} from "../../src/auth/authStateMachine.js";
import {
  BASE_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  STREAK_RESET_AFTER_MS,
  computeCooldownMs,
  formatCooldownDuration,
  formatCooldownRemaining,
  getCooldownState,
  isEmailRateLimitError,
  recordCooldownAttempt
} from "../../src/auth/emailCooldown.js";
import { createAccountRouter } from "../routes/account.js";
import { SUPABASE_TIMEOUT_MS, supabaseRequest, supabaseRpc } from "../services/supabaseAuth.js";

async function withServer(t, app) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("REGRESSION: endless password-reset loop cannot recur after skipping, tab switching, navigating, or completing reset", () => {
  // 1. User lands from valid recovery email link
  const callback = parseAuthUrlCallback({
    pathname: "/auth/recovery",
    search: "?code=pkce-recovery-123",
    hash: ""
  });
  assert.equal(callback.kind, "recovery");

  let state = createInitialAuthState(callback);
  assert.equal(state.status, AUTH_STATUS.RECOVERY_VALIDATING);
  assert.equal(isRecoveryStatus(state.status), true);

  // URL scrubbing clears /auth/recovery and ?code so reloads/navigation cannot re-trigger
  const historyCalls = [];
  const fakeLocation = { pathname: "/auth/recovery", search: "?code=pkce-recovery-123", hash: "" };
  const scrubbed = scrubAuthUrl({ replaceState: (_s, _t, url) => historyCalls.push(url) }, fakeLocation);
  assert.equal(scrubbed, "/");
  assert.deepEqual(historyCalls, ["/"]);

  // 2. Supabase validates recovery session
  state = authReducer(state, {
    type: "AUTH_EVENT",
    event: "PASSWORD_RECOVERY",
    user: { id: "user-1", email: "user@example.com" }
  });
  assert.equal(state.status, AUTH_STATUS.RECOVERY_READY);

  // 3A. Path A: User skips / cancels recovery instead of resetting password
  let cancelledState = authReducer(state, { type: "RECOVERY_CANCELLED" });
  assert.equal(cancelledState.status, AUTH_STATUS.ANONYMOUS);
  assert.equal(cancelledState.user, null);
  assert.equal(cancelledState.recoveryConsumed, true);
  assert.equal(isRecoveryStatus(cancelledState.status), false);

  // Tab switch or normal sign-in later MUST NOT reopen recovery screen!
  const afterTabSwitchSignIn = authReducer(cancelledState, {
    type: "AUTH_EVENT",
    event: "SIGNED_IN",
    user: { id: "user-1", email: "user@example.com" }
  });
  assert.equal(afterTabSwitchSignIn.status, AUTH_STATUS.AUTHENTICATED);
  assert.equal(isRecoveryStatus(afterTabSwitchSignIn.status), false);

  // 3B. Path B: User submits new password and completes reset
  let submitting = authReducer(state, { type: "RECOVERY_SUBMIT_START" });
  assert.equal(submitting.status, AUTH_STATUS.RECOVERY_SUBMITTING);

  let completed = authReducer(submitting, {
    type: "RECOVERY_SUBMIT_SUCCESS",
    user: { id: "user-1", email: "user@example.com" }
  });
  assert.equal(completed.status, AUTH_STATUS.AUTHENTICATED);
  assert.equal(completed.recoveryConsumed, true);
  assert.equal(isRecoveryStatus(completed.status), false);

  // Simulate repeated browser tab switches (SIGNED_IN + TOKEN_REFRESHED + stale PASSWORD_RECOVERY)
  for (const event of ["SIGNED_IN", "TOKEN_REFRESHED", "PASSWORD_RECOVERY", "SIGNED_IN"]) {
    completed = authReducer(completed, {
      type: "AUTH_EVENT",
      event,
      user: { id: "user-1", email: "user@example.com" }
    });
    assert.equal(completed.status, AUTH_STATUS.AUTHENTICATED, `Event ${event} must not reopen password reset`);
    assert.equal(isRecoveryStatus(completed.status), false);
  }

  // Reloading cleanly on scrubbed URL "/" starts in INITIALIZING -> AUTHENTICATED (never recovery)
  const reloadCallback = parseAuthUrlCallback({ pathname: "/", search: "", hash: "" });
  assert.equal(reloadCallback.kind, "none");
  let reloaded = createInitialAuthState(reloadCallback);
  reloaded = authReducer(reloaded, { type: "INITIAL_SESSION_RESOLVED", user: { id: "user-1", email: "user@example.com" } });
  assert.equal(reloaded.status, AUTH_STATUS.AUTHENTICATED);
});

test("recovery URL parser distinguishes valid, expired, malformed, email-verification, and non-recovery links", () => {
  assert.equal(getRecoveryRedirectUrl("https://season-fetch.vercel.app/"), "https://season-fetch.vercel.app/auth/recovery");

  // Legacy hash recovery link
  assert.equal(
    parseAuthUrlCallback({ pathname: "/", search: "", hash: "#access_token=abc&type=recovery" }).kind,
    "recovery"
  );

  // Expired recovery link with Supabase hash error params -> explicit recovery_error (never authenticated)
  const expired = parseAuthUrlCallback({
    pathname: "/auth/recovery",
    search: "",
    hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
  });
  assert.equal(expired.kind, "recovery_error");
  assert.match(expired.message, /expired/i);

  // Malformed / directly visited /auth/recovery with no token
  const missing = parseAuthUrlCallback({ pathname: "/auth/recovery", search: "", hash: "" });
  assert.equal(missing.kind, "recovery_error");
  assert.equal(missing.code, "missing_token");

  // Generic ?code= on root without recovery path/type MUST NOT falsely trigger password recovery
  const genericCode = parseAuthUrlCallback({ pathname: "/", search: "?code=oauth-123", hash: "" });
  assert.equal(genericCode.kind, "none");

  // Email verification confirmation
  const verified = parseAuthUrlCallback({ pathname: "/", search: "", hash: "#access_token=xyz&type=signup" });
  assert.equal(verified.kind, "email_verified");

  // Unrelated query params preserved during URL scrub
  let replaced = "";
  scrubAuthUrl(
    { replaceState: (_s, _t, url) => { replaced = url; } },
    { pathname: "/library", search: "?tab=movies&code=stale&error=access_denied", hash: "#error_code=otp_expired" }
  );
  assert.equal(replaced, "/library?tab=movies");
});

test("recovery validation timeout, logout during recovery, and session expiration transition deterministically", () => {
  let state = createInitialAuthState({ kind: "recovery" });
  assert.equal(state.status, AUTH_STATUS.RECOVERY_VALIDATING);

  // Expired/invalid token never resolves -> validation failure transitions to RECOVERY_ERROR
  state = authReducer(state, { type: "RECOVERY_VALIDATION_FAILED", message: "Link expired." });
  assert.equal(state.status, AUTH_STATUS.RECOVERY_ERROR);
  assert.equal(state.user, null);

  // Logout during active recovery cleanly resets to ANONYMOUS
  let activeRecovery = authReducer(createInitialAuthState({ kind: "recovery" }), {
    type: "AUTH_EVENT",
    event: "PASSWORD_RECOVERY",
    user: { id: "u1" }
  });
  assert.equal(activeRecovery.status, AUTH_STATUS.RECOVERY_READY);
  activeRecovery = authReducer(activeRecovery, { type: "AUTH_EVENT", event: "SIGNED_OUT", user: null });
  assert.equal(activeRecovery.status, AUTH_STATUS.ANONYMOUS);
  assert.equal(activeRecovery.user, null);

  // Token refresh returning null user or explicit SESSION_EXPIRED wipes stale user state
  let authed = authReducer(createInitialAuthState({ kind: "none" }), {
    type: "INITIAL_SESSION_RESOLVED",
    user: { id: "u1", email: "a@test.com" }
  });
  authed = authReducer(authed, {
    type: "ACCOUNT_STATUS_RESOLVED",
    epoch: authed.sessionEpoch,
    userId: "u1",
    profile: { id: "u1", display_name: "Alice" },
    isAdmin: true,
    suspended: false
  });
  assert.equal(authed.isAdmin, true);
  const expired = authReducer(authed, { type: "SESSION_EXPIRED" });
  assert.equal(expired.status, AUTH_STATUS.ANONYMOUS);
  assert.equal(expired.user, null);
  assert.equal(expired.profile, null);
  assert.equal(expired.isAdmin, false);
  assert.match(expired.sessionExpiredMessage, /expired/i);
});

test("switching between two accounts clears prior profile/admin state and rejects stale async responses", () => {
  let state = authReducer(createInitialAuthState({ kind: "none" }), {
    type: "INITIAL_SESSION_RESOLVED",
    user: { id: "user-a", email: "alice@test.com" }
  });
  const epochA = state.sessionEpoch;
  state = authReducer(state, {
    type: "ACCOUNT_STATUS_RESOLVED",
    epoch: epochA,
    userId: "user-a",
    profile: { id: "user-a", display_name: "Alice Admin" },
    isAdmin: true,
    suspended: false
  });
  assert.equal(state.isAdmin, true);
  assert.equal(state.profile.display_name, "Alice Admin");

  // Switch to Account B
  state = authReducer(state, {
    type: "AUTH_EVENT",
    event: "SIGNED_IN",
    user: { id: "user-b", email: "bob@test.com" }
  });
  assert.equal(state.user.id, "user-b");
  assert.equal(state.profile, null);
  assert.equal(state.isAdmin, false);
  assert.ok(state.sessionEpoch > epochA);

  // Late response from Account A's epoch MUST be ignored
  const afterStale = authReducer(state, {
    type: "ACCOUNT_STATUS_RESOLVED",
    epoch: epochA,
    userId: "user-a",
    profile: { id: "user-a", display_name: "Alice Admin" },
    isAdmin: true,
    suspended: false
  });
  assert.equal(afterStale.profile, null);
  assert.equal(afterStale.isAdmin, false);

  // Account B resolves as suspended -> status becomes SUSPENDED and isAdmin forced false
  const suspendedB = authReducer(afterStale, {
    type: "ACCOUNT_STATUS_RESOLVED",
    epoch: state.sessionEpoch,
    userId: "user-b",
    profile: null,
    isAdmin: true,
    suspended: true,
    suspensionReason: "Terms violation"
  });
  assert.equal(suspendedB.status, AUTH_STATUS.SUSPENDED);
  assert.equal(suspendedB.suspended, true);
  assert.equal(suspendedB.isAdmin, false);
  assert.equal(suspendedB.suspensionReason, "Terms violation");
});

test("password validation and non-enumerating auth error normalization", () => {
  assert.equal(validateNewPassword("short1", "short1").valid, false);
  assert.equal(validateNewPassword("allletters", "allletters").valid, false);
  assert.equal(validateNewPassword("12345678", "12345678").valid, false);
  assert.equal(validateNewPassword("StrongPass1", "Different1").valid, false);
  assert.equal(validateNewPassword("StrongPass1", "StrongPass1").valid, true);

  assert.match(normalizeAuthError({ message: "Invalid login credentials" }, "sign-in"), /Incorrect email or password/i);
  assert.match(normalizeAuthError({ message: "Email not confirmed" }, "sign-in"), /not been verified/i);
  assert.match(normalizeAuthError({ message: "Failed to fetch" }, "sign-in"), /Network error/i);
  assert.match(normalizeAuthError({ status: 429, message: "rate limit" }, "sign-in"), /Too many authentication attempts/i);
  assert.match(normalizeAuthError({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, "recovery"), /Too many email link requests/i);
  assert.match(normalizeAuthError({ status: 429, message: "rate limit" }, "recovery"), /cooldown timer/i);
});

test("email link cooldown starts at 10 minutes, escalates on each repetitive attempt, caps at 24h, and resets after quiet period", () => {
  const store = new Map();
  const storage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); }
  };

  const t0 = 1_700_000_000_000;
  assert.equal(BASE_COOLDOWN_MS, 10 * 60 * 1000);

  // Initial state: inactive, ready to send
  const initial = getCooldownState("recovery", { storage, now: t0 });
  assert.equal(initial.active, false);
  assert.equal(initial.attempts, 0);
  assert.equal(initial.remainingMs, 0);

  // Attempt 1: 10 minutes
  const a1 = recordCooldownAttempt("recovery", { storage, now: t0 });
  assert.equal(a1.active, true);
  assert.equal(a1.attempts, 1);
  assert.equal(a1.durationMs, 10 * 60 * 1000);
  assert.equal(a1.nextDurationMs, 20 * 60 * 1000);

  // Mid-cooldown check persists from storage
  const mid1 = getCooldownState("recovery", { storage, now: t0 + 3 * 60 * 1000 });
  assert.equal(mid1.active, true);
  assert.equal(mid1.remainingMs, 7 * 60 * 1000);

  // Verification bucket stays independent of recovery bucket
  assert.equal(getCooldownState("verification", { storage, now: t0 }).active, false);

  // Attempt 2 right after 10m expires: escalates to 20 minutes
  const t2 = t0 + 10 * 60 * 1000 + 1000;
  assert.equal(getCooldownState("recovery", { storage, now: t2 }).active, false);
  const a2 = recordCooldownAttempt("recovery", { storage, now: t2 });
  assert.equal(a2.attempts, 2);
  assert.equal(a2.durationMs, 20 * 60 * 1000);

  // Attempt 3: 40 minutes
  const t3 = t2 + 20 * 60 * 1000 + 1000;
  const a3 = recordCooldownAttempt("recovery", { storage, now: t3 });
  assert.equal(a3.attempts, 3);
  assert.equal(a3.durationMs, 40 * 60 * 1000);

  // Attempt 4: 80 minutes (1 hour 20 minutes)
  const t4 = t3 + 40 * 60 * 1000 + 1000;
  const a4 = recordCooldownAttempt("recovery", { storage, now: t4 });
  assert.equal(a4.attempts, 4);
  assert.equal(a4.durationMs, 80 * 60 * 1000);

  // High repetitive attempts keep increasing up to the 24-hour cap
  assert.equal(computeCooldownMs(5), 160 * 60 * 1000);
  assert.equal(computeCooldownMs(10), MAX_COOLDOWN_MS);

  // After 24h quiet period past expiration, streak resets back to 10 minutes
  const afterQuiet = a4.nextAllowedAt + STREAK_RESET_AFTER_MS + 1000;
  const resetState = getCooldownState("recovery", { storage, now: afterQuiet });
  assert.equal(resetState.active, false);
  assert.equal(resetState.attempts, 0);
  const fresh = recordCooldownAttempt("recovery", { storage, now: afterQuiet });
  assert.equal(fresh.attempts, 1);
  assert.equal(fresh.durationMs, 10 * 60 * 1000);

  // Formatting & error detection helpers
  assert.equal(formatCooldownRemaining(10 * 60 * 1000), "10m 00s");
  assert.equal(formatCooldownRemaining(65_000), "1m 05s");
  assert.equal(formatCooldownRemaining(45_000), "45s");
  assert.equal(formatCooldownRemaining(80 * 60 * 1000), "1h 20m 00s");
  assert.equal(formatCooldownDuration(10 * 60 * 1000), "10 minutes");
  assert.equal(formatCooldownDuration(80 * 60 * 1000), "1 hour 20 minutes");
  assert.equal(isEmailRateLimitError({ status: 429 }), true);
  assert.equal(isEmailRateLimitError({ code: "over_email_send_rate_limit" }), true);
  assert.equal(isEmailRateLimitError({ message: "Invalid login credentials" }), false);
});

test("GET /api/account/session verifies JWT, detects suspension, returns admin/profile, and fails closed on outage", async t => {
  const app = express();
  app.use("/api", createAccountRouter({
    verifyToken: async token => {
      if (token === "tok-active") return { sub: "user-active" };
      if (token === "tok-admin") return { sub: "user-admin" };
      if (token === "tok-suspended") return { sub: "user-suspended" };
      if (token === "tok-outage") return { sub: "user-outage" };
      throw new Error("Invalid JWT");
    },
    request: async (path, token) => {
      if (token === "tok-outage") throw new Error("DB unreachable");
      if (path.startsWith("account_suspensions")) {
        return token === "tok-suspended" ? [{ suspended: true, reason: "Abuse detected" }] : [];
      }
      if (path.startsWith("profiles")) {
        return [{ id: token === "tok-admin" ? "user-admin" : "user-active", display_name: "Verified User" }];
      }
      return [];
    },
    rpc: async (name, _args, token) => name === "is_admin" && token === "tok-admin"
  }));

  const base = await withServer(t, app);

  const anon = await fetch(`${base}/api/account/session`);
  assert.equal(anon.status, 401);

  const active = await fetch(`${base}/api/account/session`, { headers: { Authorization: "Bearer tok-active" } });
  assert.equal(active.status, 200);
  const activeBody = await active.json();
  assert.equal(activeBody.active, true);
  assert.equal(activeBody.suspended, false);
  assert.equal(activeBody.isAdmin, false);
  assert.equal(activeBody.profile.display_name, "Verified User");

  const admin = await fetch(`${base}/api/account/session`, { headers: { Authorization: "Bearer tok-admin" } });
  assert.equal(admin.status, 200);
  assert.equal((await admin.json()).isAdmin, true);

  const suspended = await fetch(`${base}/api/account/session`, { headers: { Authorization: "Bearer tok-suspended" } });
  assert.equal(suspended.status, 200);
  const suspendedBody = await suspended.json();
  assert.equal(suspendedBody.active, false);
  assert.equal(suspendedBody.suspended, true);
  assert.equal(suspendedBody.suspensionReason, "Abuse detected");
  assert.equal(suspendedBody.isAdmin, false);
  assert.equal(suspendedBody.profile, null);

  const outage = await fetch(`${base}/api/account/session`, { headers: { Authorization: "Bearer tok-outage" } });
  assert.equal(outage.status, 503);
});

test("supabaseAuth configures 15s AbortSignal timeout, disables redirects, and useAuthController guards against duplicate listeners", async t => {
  assert.equal(SUPABASE_TIMEOUT_MS, 15_000);

  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_ANON_KEY;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prevKey;
  });

  process.env.SUPABASE_URL = "https://auth-timeout.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  const captured = [];
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return Response.json([]);
  };

  await supabaseRequest("profiles?select=id", "tok");
  await supabaseRpc("is_admin", {}, "tok");
  assert.equal(captured.length, 2);
  for (const call of captured) {
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal instanceof AbortSignal);
  }

  // Verify duplicate auth listener prevention in useAuthController
  const controllerSrc = await readFile(new URL("../../src/auth/useAuthController.js", import.meta.url), "utf8");
  assert.match(controllerSrc, /if \(subscriptionRef\.current\) return undefined/);
  assert.match(controllerSrc, /subscriptionRef\.current\.unsubscribe\(\)/);
  assert.match(controllerSrc, /subscriptionRef\.current = null/);
});

test("migration 0007 revokes anon/client execute on security functions, hardens grants, and indexes foreign keys", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/0007_security_and_index_hardening.sql", import.meta.url), "utf8");

  // Trigger functions must not be callable by public, anon, or authenticated
  assert.match(sql, /revoke all on function public\.handle_new_user\(\) from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.handle_new_admin_user\(\) from public, anon, authenticated/i);

  // Anon must not execute is_account_active, is_admin, or admin_set_user_suspension
  assert.match(sql, /revoke all on function public\.is_account_active\(\) from public, anon/i);
  assert.match(sql, /revoke all on function public\.is_admin\(\) from public, anon/i);
  assert.match(sql, /revoke all on function public\.admin_set_user_suspension\(uuid, boolean, text\) from public, anon/i);

  // is_admin is SECURITY INVOKER with pinned search_path
  assert.match(sql, /create or replace function public\.is_admin\(\)[\s\S]*?security invoker[\s\S]*?set search_path = public, pg_temp/i);

  // Anon profile policy split cleanly from authenticated policy
  assert.match(sql, /create policy "Anon can read public profiles"[\s\S]*?on public\.profiles for select[\s\S]*?to anon[\s\S]*?using \(is_public = true\)/i);

  // Least-privilege anon revocations on internal tables
  assert.match(sql, /revoke all on public\.account_suspensions from anon/i);
  assert.match(sql, /revoke all on public\.admin_roles from anon/i);
  assert.match(sql, /revoke all on public\.audit_logs from anon/i);

  // Covering indexes for foreign keys
  assert.match(sql, /idx_account_suspensions_suspended_by/i);
  assert.match(sql, /idx_audit_logs_actor_id/i);
  assert.match(sql, /idx_audit_logs_target_user_id/i);
});
