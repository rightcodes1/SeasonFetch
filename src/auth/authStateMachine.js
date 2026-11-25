export const AUTH_STATUS = {
  INITIALIZING: "initializing",
  ANONYMOUS: "anonymous",
  AUTHENTICATED: "authenticated",
  SUSPENDED: "suspended",
  RECOVERY_VALIDATING: "recovery_validating",
  RECOVERY_READY: "recovery_ready",
  RECOVERY_SUBMITTING: "recovery_submitting",
  RECOVERY_ERROR: "recovery_error"
};

const AUTH_QUERY_KEYS = [
  "code",
  "token_hash",
  "type",
  "error",
  "error_code",
  "error_description"
];

const AUTH_HASH_MARKERS = [
  "access_token",
  "refresh_token",
  "type=",
  "error=",
  "error_code=",
  "error_description="
];

export function isRecoveryStatus(status) {
  return status === AUTH_STATUS.RECOVERY_VALIDATING
    || status === AUTH_STATUS.RECOVERY_READY
    || status === AUTH_STATUS.RECOVERY_SUBMITTING
    || status === AUTH_STATUS.RECOVERY_ERROR;
}

export function getRecoveryRedirectUrl(origin) {
  const cleanOrigin = String(origin || "").replace(/\/+$/, "");
  return `${cleanOrigin}/auth/recovery`;
}

export function parseAuthUrlCallback(locationLike) {
  if (!locationLike) return { kind: "none", hasAuthParams: false };

  const pathname = String(locationLike.pathname || "/").replace(/\/+$/, "") || "/";
  const searchParams = new URLSearchParams(String(locationLike.search || "").replace(/^\?/, ""));
  const rawHash = String(locationLike.hash || "").replace(/^#/, "");
  const hashParams = new URLSearchParams(rawHash);

  const isRecoveryPath = pathname === "/auth/recovery";
  const queryType = (searchParams.get("type") || "").toLowerCase();
  const hashType = (hashParams.get("type") || "").toLowerCase();
  const error = hashParams.get("error") || searchParams.get("error") || "";
  const errorCode = hashParams.get("error_code") || searchParams.get("error_code") || "";
  const errorDescription = hashParams.get("error_description") || searchParams.get("error_description") || "";
  const hasCode = searchParams.has("code");
  const hasTokenHash = searchParams.has("token_hash");
  const hasAccessToken = hashParams.has("access_token");

  const hasAuthParams = isRecoveryPath
    || AUTH_QUERY_KEYS.some(key => searchParams.has(key))
    || AUTH_HASH_MARKERS.some(marker => rawHash.includes(marker));

  if (error || errorCode) {
    const expired = /expired|otp_expired|invalid/i.test(`${errorCode} ${errorDescription} ${error}`);
    return {
      kind: isRecoveryPath || hashType === "recovery" || queryType === "recovery" || expired
        ? "recovery_error"
        : "auth_error",
      code: errorCode || error,
      message: formatRecoveryLinkError(errorCode || error, errorDescription),
      hasAuthParams: true
    };
  }

  if (hashType === "recovery" || queryType === "recovery" || (isRecoveryPath && (hasCode || hasTokenHash || hasAccessToken))) {
    return {
      kind: "recovery",
      hasCode,
      hasTokenHash,
      hasAccessToken,
      hasAuthParams: true
    };
  }

  // Visited /auth/recovery directly with no token/code: treat as malformed/expired recovery link.
  if (isRecoveryPath) {
    return {
      kind: "recovery_error",
      code: "missing_token",
      message: "This password reset link is incomplete or has already been used. Request a new reset link below.",
      hasAuthParams: true
    };
  }

  if (hashType === "signup" || hashType === "email" || queryType === "signup" || queryType === "email") {
    return {
      kind: "email_verified",
      hasAuthParams: true
    };
  }

  return { kind: "none", hasAuthParams };
}

export function formatRecoveryLinkError(code = "", description = "") {
  const combined = `${code} ${description}`.toLowerCase();
  if (combined.includes("expired") || combined.includes("otp_expired")) {
    return "This password reset link has expired. Request a new link to choose a new password.";
  }
  if (combined.includes("access_denied") || combined.includes("invalid") || combined.includes("not found")) {
    return "This password reset link is invalid or has already been used. Request a fresh link to continue.";
  }
  return "We could not validate your password reset link. Please request a new reset link.";
}

export function scrubAuthUrl(historyRef, locationRef) {
  if (!historyRef?.replaceState || !locationRef) return "";
  const rawPath = String(locationRef.pathname || "/");
  const normalizedPath = rawPath.replace(/\/+$/, "") || "/";
  const nextPath = normalizedPath === "/auth/recovery" ? "/" : rawPath;

  const params = new URLSearchParams(String(locationRef.search || "").replace(/^\?/, ""));
  for (const key of AUTH_QUERY_KEYS) params.delete(key);
  const nextSearch = params.toString() ? `?${params.toString()}` : "";

  const rawHash = String(locationRef.hash || "");
  const shouldDropHash = AUTH_HASH_MARKERS.some(marker => rawHash.includes(marker));
  const nextHash = shouldDropHash ? "" : rawHash;

  const nextUrl = `${nextPath}${nextSearch}${nextHash}`;
  const currentUrl = `${rawPath}${locationRef.search || ""}${rawHash}`;
  if (nextUrl !== currentUrl) {
    historyRef.replaceState({}, "", nextUrl);
  }
  return nextUrl;
}

export function validateNewPassword(password, confirmPassword) {
  const value = String(password || "");
  if (value.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters long." };
  }
  if (value.length > 128) {
    return { valid: false, error: "Password must be 128 characters or fewer." };
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return { valid: false, error: "Use at least one letter and one number." };
  }
  if (confirmPassword !== undefined && value !== String(confirmPassword)) {
    return { valid: false, error: "The passwords do not match." };
  }
  return { valid: true, error: "" };
}

export function normalizeAuthError(error, context = "sign-in") {
  const raw = String(error?.message || "").trim();
  const lower = raw.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("timeout")) {
    return "Network error while contacting the authentication service. Check your connection and try again.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests") || error?.status === 429) {
    return "Too many authentication attempts. Please wait a minute before trying again.";
  }
  if (context === "sign-in" && (lower.includes("invalid login credentials") || lower.includes("invalid credentials"))) {
    return "Incorrect email or password. Please check your credentials and try again.";
  }
  if (context === "sign-in" && lower.includes("email not confirmed")) {
    return "Your email address has not been verified yet. Check your inbox or request a new verification email.";
  }
  if (context === "register" && lower.includes("already registered")) {
    return "An account with this email already exists. Try signing in or resetting your password.";
  }
  if (context === "reset" && (lower.includes("same password") || lower.includes("different from the old password"))) {
    return "Choose a new password that is different from your previous password.";
  }
  if (context === "reset" && (lower.includes("session missing") || lower.includes("jwt") || lower.includes("expired"))) {
    return "Your recovery session has expired. Request a new password reset link.";
  }
  return raw || "Authentication failed. Please try again.";
}

export function createInitialAuthState(callbackInfo = { kind: "none" }, { configured = true } = {}) {
  if (!configured) {
    return {
      status: AUTH_STATUS.ANONYMOUS,
      user: null,
      profile: null,
      isAdmin: false,
      suspended: false,
      suspensionReason: "",
      profileLoading: false,
      profileError: "",
      recoveryError: "",
      recoveryConsumed: false,
      sessionExpiredMessage: "",
      emailVerifiedNotice: false,
      sessionEpoch: 0
    };
  }

  if (callbackInfo.kind === "recovery") {
    return {
      status: AUTH_STATUS.RECOVERY_VALIDATING,
      user: null,
      profile: null,
      isAdmin: false,
      suspended: false,
      suspensionReason: "",
      profileLoading: false,
      profileError: "",
      recoveryError: "",
      recoveryConsumed: false,
      sessionExpiredMessage: "",
      emailVerifiedNotice: false,
      sessionEpoch: 0
    };
  }

  if (callbackInfo.kind === "recovery_error") {
    return {
      status: AUTH_STATUS.RECOVERY_ERROR,
      user: null,
      profile: null,
      isAdmin: false,
      suspended: false,
      suspensionReason: "",
      profileLoading: false,
      profileError: "",
      recoveryError: callbackInfo.message || formatRecoveryLinkError(),
      recoveryConsumed: true,
      sessionExpiredMessage: "",
      emailVerifiedNotice: false,
      sessionEpoch: 0
    };
  }

  return {
    status: AUTH_STATUS.INITIALIZING,
    user: null,
    profile: null,
    isAdmin: false,
    suspended: false,
    suspensionReason: "",
    profileLoading: false,
    profileError: "",
    recoveryError: "",
    recoveryConsumed: false,
    sessionExpiredMessage: "",
    emailVerifiedNotice: callbackInfo.kind === "email_verified",
    sessionEpoch: 0
  };
}

function clearAccountFields(state, overrides = {}) {
  return {
    ...state,
    user: null,
    profile: null,
    isAdmin: false,
    suspended: false,
    suspensionReason: "",
    profileLoading: false,
    profileError: "",
    sessionEpoch: state.sessionEpoch + 1,
    ...overrides
  };
}

export function authReducer(state, action) {
  switch (action.type) {
    case "INITIAL_SESSION_RESOLVED": {
      const user = action.user || null;
      if (state.status === AUTH_STATUS.RECOVERY_ERROR) {
        return state;
      }
      if (state.status === AUTH_STATUS.RECOVERY_VALIDATING) {
        if (user) {
          return {
            ...state,
            status: AUTH_STATUS.RECOVERY_READY,
            user,
            recoveryError: "",
            sessionEpoch: state.sessionEpoch + 1
          };
        }
        return state;
      }
      if (!user) {
        return clearAccountFields(state, { status: AUTH_STATUS.ANONYMOUS });
      }
      return {
        ...state,
        status: AUTH_STATUS.AUTHENTICATED,
        user,
        profileLoading: true,
        profileError: "",
        sessionExpiredMessage: "",
        sessionEpoch: state.sessionEpoch + 1
      };
    }

    case "AUTH_EVENT": {
      const { event, user } = action;

      if (event === "SIGNED_OUT") {
        // Leaving recovery or logging out always exits recovery cleanly.
        const preserveRecoveryError = state.status === AUTH_STATUS.RECOVERY_ERROR;
        return clearAccountFields(state, {
          status: preserveRecoveryError ? AUTH_STATUS.RECOVERY_ERROR : AUTH_STATUS.ANONYMOUS,
          recoveryError: preserveRecoveryError ? state.recoveryError : "",
          recoveryConsumed: true,
          emailVerifiedNotice: false
        });
      }

      if (event === "PASSWORD_RECOVERY") {
        // Never reopen recovery if this session already completed or exited recovery.
        if (state.recoveryConsumed && state.status === AUTH_STATUS.AUTHENTICATED) {
          return state;
        }
        if (!user) {
          return clearAccountFields(state, {
            status: AUTH_STATUS.RECOVERY_ERROR,
            recoveryError: formatRecoveryLinkError("invalid"),
            recoveryConsumed: true
          });
        }
        return {
          ...state,
          status: AUTH_STATUS.RECOVERY_READY,
          user,
          profile: null,
          isAdmin: false,
          suspended: false,
          suspensionReason: "",
          recoveryError: "",
          recoveryConsumed: false,
          sessionExpiredMessage: "",
          sessionEpoch: state.sessionEpoch + 1
        };
      }

      if (event === "SIGNED_IN") {
        if (!user) return state;

        // If we are explicitly validating a fresh recovery callback, promote to RECOVERY_READY once.
        if (state.status === AUTH_STATUS.RECOVERY_VALIDATING && !state.recoveryConsumed) {
          return {
            ...state,
            status: AUTH_STATUS.RECOVERY_READY,
            user,
            recoveryError: "",
            sessionEpoch: state.sessionEpoch + 1
          };
        }

        // If already in active recovery form, keep recovery state stable (don't drop out mid-form).
        if (state.status === AUTH_STATUS.RECOVERY_READY || state.status === AUTH_STATUS.RECOVERY_SUBMITTING) {
          return { ...state, user };
        }

        // Tab-switch / token re-hydration SIGNED_IN for same authenticated user:
        // NEVER re-enter recovery; keep existing profile/suspension state without flicker.
        if (
          (state.status === AUTH_STATUS.AUTHENTICATED || state.status === AUTH_STATUS.SUSPENDED)
          && state.user?.id === user.id
        ) {
          return { ...state, user, sessionExpiredMessage: "" };
        }

        // Fresh login or account switch (user A -> user B): reset prior user's profile/admin state cleanly!
        return {
          ...state,
          status: AUTH_STATUS.AUTHENTICATED,
          user,
          profile: null,
          isAdmin: false,
          suspended: false,
          suspensionReason: "",
          profileLoading: true,
          profileError: "",
          recoveryError: "",
          recoveryConsumed: true,
          sessionExpiredMessage: "",
          sessionEpoch: state.sessionEpoch + 1
        };
      }

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        if (!user) {
          return clearAccountFields(state, {
            status: AUTH_STATUS.ANONYMOUS,
            sessionExpiredMessage: "Your session expired. Sign in again to access your library and account."
          });
        }
        // Account identity mismatch during refresh: wipe old profile cleanly.
        if (state.user && state.user.id !== user.id) {
          return {
            ...state,
            status: AUTH_STATUS.AUTHENTICATED,
            user,
            profile: null,
            isAdmin: false,
            suspended: false,
            suspensionReason: "",
            profileLoading: true,
            profileError: "",
            sessionEpoch: state.sessionEpoch + 1
          };
        }
        return { ...state, user };
      }

      return state;
    }

    case "RECOVERY_VALIDATION_FAILED": {
      if (state.status !== AUTH_STATUS.RECOVERY_VALIDATING && state.status !== AUTH_STATUS.RECOVERY_READY) {
        return state;
      }
      return clearAccountFields(state, {
        status: AUTH_STATUS.RECOVERY_ERROR,
        recoveryError: action.message || formatRecoveryLinkError("expired"),
        recoveryConsumed: true
      });
    }

    case "RECOVERY_SUBMIT_START": {
      if (state.status !== AUTH_STATUS.RECOVERY_READY) return state;
      return { ...state, status: AUTH_STATUS.RECOVERY_SUBMITTING, recoveryError: "" };
    }

    case "RECOVERY_SUBMIT_ERROR": {
      if (state.status !== AUTH_STATUS.RECOVERY_SUBMITTING) return state;
      return {
        ...state,
        status: AUTH_STATUS.RECOVERY_READY,
        recoveryError: action.message || "Unable to update your password."
      };
    }

    case "RECOVERY_SUBMIT_SUCCESS": {
      const nextUser = action.user || state.user;
      if (!nextUser) {
        return clearAccountFields(state, {
          status: AUTH_STATUS.ANONYMOUS,
          recoveryError: "",
          recoveryConsumed: true
        });
      }
      return {
        ...state,
        status: AUTH_STATUS.AUTHENTICATED,
        user: nextUser,
        profileLoading: true,
        profileError: "",
        recoveryError: "",
        recoveryConsumed: true,
        sessionExpiredMessage: "",
        sessionEpoch: state.sessionEpoch + 1
      };
    }

    case "RECOVERY_CANCELLED": {
      return clearAccountFields(state, {
        status: AUTH_STATUS.ANONYMOUS,
        recoveryError: "",
        recoveryConsumed: true
      });
    }

    case "ACCOUNT_STATUS_LOADING": {
      if (action.epoch !== state.sessionEpoch) return state;
      return { ...state, profileLoading: true, profileError: "" };
    }

    case "ACCOUNT_STATUS_RESOLVED": {
      if (action.epoch !== state.sessionEpoch) return state;
      if (!state.user || state.user.id !== action.userId) return state;
      if (isRecoveryStatus(state.status)) return state;
      return {
        ...state,
        status: action.suspended ? AUTH_STATUS.SUSPENDED : AUTH_STATUS.AUTHENTICATED,
        profile: action.profile || null,
        isAdmin: Boolean(action.isAdmin && !action.suspended),
        suspended: Boolean(action.suspended),
        suspensionReason: action.suspensionReason || "",
        profileLoading: false,
        profileError: ""
      };
    }

    case "ACCOUNT_STATUS_ERROR": {
      if (action.epoch !== state.sessionEpoch) return state;
      return {
        ...state,
        profileLoading: false,
        profileError: action.message || "Unable to load account details right now."
      };
    }

    case "PROFILE_UPDATED": {
      if (!state.user || !action.profile || action.profile.id !== state.user.id) return state;
      return { ...state, profile: action.profile, profileError: "" };
    }

    case "SESSION_EXPIRED": {
      return clearAccountFields(state, {
        status: AUTH_STATUS.ANONYMOUS,
        recoveryError: "",
        recoveryConsumed: true,
        sessionExpiredMessage: action.message || "Your session expired. Sign in again to continue."
      });
    }

    case "DISMISS_SESSION_NOTICE": {
      return { ...state, sessionExpiredMessage: "", emailVerifiedNotice: false };
    }

    default:
      return state;
  }
}
