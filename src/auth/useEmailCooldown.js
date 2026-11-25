import { useCallback, useEffect, useState } from "react";
import {
  COOLDOWN_CHANGE_EVENT,
  formatCooldownRemaining,
  getCooldownState,
  recordCooldownAttempt
} from "./emailCooldown.js";

export function useEmailCooldown(action) {
  const [state, setState] = useState(() => getCooldownState(action));

  const sync = useCallback(() => {
    setState(getCooldownState(action));
  }, [action]);

  useEffect(() => {
    sync();
  }, [sync]);

  useEffect(() => {
    if (!state.active) return undefined;
    const interval = window.setInterval(() => {
      const next = getCooldownState(action);
      setState(next);
      if (!next.active) {
        window.clearInterval(interval);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [action, state.active, state.nextAllowedAt]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleStorage = () => sync();
    const handleCustom = event => {
      if (!event?.detail?.action || event.detail.action === action) {
        sync();
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(COOLDOWN_CHANGE_EVENT, handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(COOLDOWN_CHANGE_EVENT, handleCustom);
    };
  }, [action, sync]);

  const triggerCooldown = useCallback(() => {
    const next = recordCooldownAttempt(action);
    setState(next);
    return next;
  }, [action]);

  return {
    ...state,
    formattedRemaining: formatCooldownRemaining(state.remainingMs),
    triggerCooldown
  };
}
