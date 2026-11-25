import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  AUTH_STATUS,
  authReducer,
  createInitialAuthState,
  formatRecoveryLinkError,
  isRecoveryStatus,
  parseAuthUrlCallback,
  scrubAuthUrl
} from "./authStateMachine.js";
import { signOutFromAuth } from "../utils/accountActions.js";

const RECOVERY_VALIDATION_TIMEOUT_MS = 5000;

async function fetchAccountSession(accessToken) {
  const response = await fetch("/api/account/session", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    const error = new Error(data.error || "Session expired.");
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error || "Unable to verify account status.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function useAuthController({ supabase, onToast, onNotice }) {
  const initialCallbackRef = useRef(null);
  if (initialCallbackRef.current === null) {
    initialCallbackRef.current = typeof window !== "undefined"
      ? parseAuthUrlCallback(window.location)
      : { kind: "none", hasAuthParams: false };
  }

  const [state, dispatch] = useReducer(
    authReducer,
    undefined,
    () => createInitialAuthState(initialCallbackRef.current, { configured: Boolean(supabase) })
  );

  const subscriptionRef = useRef(null);
  const recoveryTimerRef = useRef(null);
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  // Subscribe once to Supabase Auth state changes and resolve initial session.
  useEffect(() => {
    if (!supabase) return undefined;
    if (subscriptionRef.current) return undefined;

    let active = true;
    const callbackInfo = initialCallbackRef.current;

    if (callbackInfo.hasAuthParams && typeof window !== "undefined") {
      // Allow Supabase detectSessionInUrl to read the URL on mount, then scrub asynchronously
      // so reloads, tab switches, or route changes can never re-trigger recovery.
      queueMicrotask(() => {
        if (active) scrubAuthUrl(window.history, window.location);
      });
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && typeof window !== "undefined") {
        scrubAuthUrl(window.history, window.location);
      }
      dispatch({ type: "AUTH_EVENT", event, user: session?.user || null });
    });
    subscriptionRef.current = listener.subscription;

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          if (statusRef.current === AUTH_STATUS.RECOVERY_VALIDATING) {
            dispatch({
              type: "RECOVERY_VALIDATION_FAILED",
              message: formatRecoveryLinkError("expired", error.message)
            });
          } else {
            dispatch({ type: "INITIAL_SESSION_RESOLVED", user: null });
          }
          return;
        }
        dispatch({ type: "INITIAL_SESSION_RESOLVED", user: data.session?.user || null });
      })
      .catch(() => {
        if (!active) return;
        if (statusRef.current === AUTH_STATUS.RECOVERY_VALIDATING) {
          dispatch({
            type: "RECOVERY_VALIDATION_FAILED",
            message: formatRecoveryLinkError("expired")
          });
        } else {
          dispatch({ type: "INITIAL_SESSION_RESOLVED", user: null });
        }
      });

    return () => {
      active = false;
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [supabase]);

  // Timeout guard: never leave a malformed/reused recovery link stuck in validating state.
  useEffect(() => {
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    if (state.status !== AUTH_STATUS.RECOVERY_VALIDATING) return undefined;

    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null;
      dispatch({
        type: "RECOVERY_VALIDATION_FAILED",
        message: formatRecoveryLinkError("expired")
      });
    }, RECOVERY_VALIDATION_TIMEOUT_MS);

    return () => {
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    };
  }, [state.status]);

  // Sync authoritative account status (profile, admin, suspension) whenever authenticated session epoch changes.
  const syncAccountSession = useCallback(async (targetUser, targetEpoch) => {
    if (!supabase || !targetUser) return;
    dispatch({ type: "ACCOUNT_STATUS_LOADING", epoch: targetEpoch });
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken || data.session?.user?.id !== targetUser.id) {
        dispatch({ type: "SESSION_EXPIRED" });
        return;
      }

      const account = await fetchAccountSession(accessToken);
      dispatch({
        type: "ACCOUNT_STATUS_RESOLVED",
        epoch: targetEpoch,
        userId: targetUser.id,
        profile: account.profile || null,
        isAdmin: Boolean(account.isAdmin),
        suspended: Boolean(account.suspended),
        suspensionReason: account.suspensionReason || ""
      });
    } catch (error) {
      if (error?.status === 401) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        dispatch({
          type: "SESSION_EXPIRED",
          message: "Your session expired or was revoked. Sign in again to continue."
        });
        return;
      }
      dispatch({
        type: "ACCOUNT_STATUS_ERROR",
        epoch: targetEpoch,
        message: error.message || "Unable to verify account details right now."
      });
    }
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !state.user) return;
    if (state.status !== AUTH_STATUS.AUTHENTICATED && state.status !== AUTH_STATUS.SUSPENDED) return;
    syncAccountSession(state.user, state.sessionEpoch);
  }, [supabase, state.user?.id, state.sessionEpoch, state.status === AUTH_STATUS.AUTHENTICATED, syncAccountSession]);

  const completePasswordReset = useCallback(async newPassword => {
    if (!supabase) throw new Error("Supabase authentication is not configured.");
    dispatch({ type: "RECOVERY_SUBMIT_START" });
    try {
      const { data, error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      if (typeof window !== "undefined") {
        scrubAuthUrl(window.history, window.location);
      }
      dispatch({ type: "RECOVERY_SUBMIT_SUCCESS", user: data?.user || state.user });
      onToast?.("Password updated. You are now signed in.");
      return true;
    } catch (error) {
      dispatch({ type: "RECOVERY_SUBMIT_ERROR", message: error.message });
      throw error;
    }
  }, [supabase, state.user, onToast]);

  const cancelRecovery = useCallback(async () => {
    if (typeof window !== "undefined") {
      scrubAuthUrl(window.history, window.location);
    }
    if (supabase) {
      // Do not leave a skipped/abandoned recovery session silently signed in.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    }
    dispatch({ type: "RECOVERY_CANCELLED" });
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) {
      onNotice?.("Sign-out is unavailable because Supabase authentication is not configured.");
      return false;
    }
    try {
      await signOutFromAuth(supabase.auth);
      if (typeof window !== "undefined") {
        scrubAuthUrl(window.history, window.location);
      }
      dispatch({ type: "AUTH_EVENT", event: "SIGNED_OUT", user: null });
      onToast?.("Signed out");
      return true;
    } catch (error) {
      onNotice?.(`Unable to sign out: ${error.message || "Supabase did not confirm sign-out."}`);
      return false;
    }
  }, [supabase, onToast, onNotice]);

  const handleSessionExpired = useCallback(async message => {
    if (supabase) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    }
    dispatch({ type: "SESSION_EXPIRED", message });
  }, [supabase]);

  const setProfile = useCallback(profile => {
    dispatch({ type: "PROFILE_UPDATED", profile });
  }, []);

  const retryAccountSync = useCallback(() => {
    if (state.user) syncAccountSession(state.user, state.sessionEpoch);
  }, [state.user, state.sessionEpoch, syncAccountSession]);

  const dismissSessionNotice = useCallback(() => {
    dispatch({ type: "DISMISS_SESSION_NOTICE" });
  }, []);

  const isRecovering = isRecoveryStatus(state.status);
  const authenticatedUser = state.status === AUTH_STATUS.AUTHENTICATED || state.status === AUTH_STATUS.SUSPENDED
    ? state.user
    : null;

  return {
    ...state,
    isRecovering,
    authenticatedUser,
    completePasswordReset,
    cancelRecovery,
    signOut,
    handleSessionExpired,
    setProfile,
    retryAccountSync,
    dismissSessionNotice
  };
}
