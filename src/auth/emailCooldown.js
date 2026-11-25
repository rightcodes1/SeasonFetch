export const BASE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours cap
export const STREAK_RESET_AFTER_MS = 24 * 60 * 60 * 1000; // Reset escalation after 24h quiet period
export const COOLDOWN_CHANGE_EVENT = "seasonfetch:email-cooldown-change";

const STORAGE_PREFIX = "seasonfetch_email_cooldown_v1:";

function getDefaultStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function storageKeyFor(action) {
  return `${STORAGE_PREFIX}${String(action || "recovery")}`;
}

export function computeCooldownMs(attemptNumber) {
  const n = Math.max(1, Math.floor(Number(attemptNumber) || 1));
  // Escalates on every repetitive request: 10m -> 20m -> 40m -> 80m -> 160m ... capped at 24h
  const exponent = Math.min(n - 1, 16);
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * (2 ** exponent));
}

function readRecord(action, storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKeyFor(action));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed
      || typeof parsed !== "object"
      || !Number.isFinite(parsed.attempts)
      || !Number.isFinite(parsed.nextAllowedAt)
    ) {
      return null;
    }
    return {
      attempts: Math.max(0, Math.floor(parsed.attempts)),
      lastAttemptAt: Number.isFinite(parsed.lastAttemptAt) ? parsed.lastAttemptAt : 0,
      nextAllowedAt: parsed.nextAllowedAt
    };
  } catch {
    return null;
  }
}

function writeRecord(action, record, storage) {
  if (!storage) return;
  try {
    storage.setItem(storageKeyFor(action), JSON.stringify(record));
  } catch {
    // Ignore quota/private-mode storage errors; caller still gets in-memory state.
  }
}

function removeRecord(action, storage) {
  if (!storage) return;
  try {
    storage.removeItem(storageKeyFor(action));
  } catch {
    // Ignore storage errors.
  }
}

export function getCooldownState(action, { storage = getDefaultStorage(), now = Date.now() } = {}) {
  const record = readRecord(action, storage);
  if (!record || record.attempts <= 0) {
    return {
      active: false,
      remainingMs: 0,
      attempts: 0,
      nextAllowedAt: 0,
      nextDurationMs: BASE_COOLDOWN_MS
    };
  }

  // If the user hasn't made another repetitive request for 24h after the last cooldown ended, reset streak.
  if (now >= record.nextAllowedAt + STREAK_RESET_AFTER_MS) {
    removeRecord(action, storage);
    return {
      active: false,
      remainingMs: 0,
      attempts: 0,
      nextAllowedAt: 0,
      nextDurationMs: BASE_COOLDOWN_MS
    };
  }

  const remainingMs = Math.max(0, record.nextAllowedAt - now);
  return {
    active: remainingMs > 0,
    remainingMs,
    attempts: record.attempts,
    nextAllowedAt: record.nextAllowedAt,
    nextDurationMs: computeCooldownMs(record.attempts + 1)
  };
}

export function recordCooldownAttempt(action, { storage = getDefaultStorage(), now = Date.now() } = {}) {
  const current = getCooldownState(action, { storage, now });
  const nextAttempts = current.attempts + 1;
  const durationMs = computeCooldownMs(nextAttempts);
  const nextAllowedAt = now + durationMs;

  writeRecord(action, {
    attempts: nextAttempts,
    lastAttemptAt: now,
    nextAllowedAt
  }, storage);

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(COOLDOWN_CHANGE_EVENT, { detail: { action } }));
    } catch {
      // Ignore event dispatch failures in non-DOM test runtimes.
    }
  }

  return {
    active: true,
    remainingMs: durationMs,
    durationMs,
    attempts: nextAttempts,
    nextAllowedAt,
    nextDurationMs: computeCooldownMs(nextAttempts + 1)
  };
}

export function isEmailRateLimitError(error) {
  if (!error) return false;
  if (error.status === 429) return true;
  const combined = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return combined.includes("over_email_send_rate_limit")
    || combined.includes("email rate limit")
    || combined.includes("rate limit")
    || combined.includes("too many requests");
}

export function formatCooldownRemaining(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs || 0) / 1000));
  if (totalSeconds <= 0) return "0s";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function formatCooldownDuration(durationMs) {
  const totalMinutes = Math.max(1, Math.round(Number(durationMs || 0) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  if (hours > 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
