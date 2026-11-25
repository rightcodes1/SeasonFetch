import { useEffect, useState } from "react";
import {
  AUTH_STATUS,
  getRecoveryRedirectUrl,
  isRecoveryStatus,
  normalizeAuthError,
  validateNewPassword
} from "../auth/authStateMachine.js";
import { formatCooldownDuration, isEmailRateLimitError } from "../auth/emailCooldown.js";
import { useEmailCooldown } from "../auth/useEmailCooldown.js";

function PasswordInput({ label, value, onChange, autoComplete, minLength, required = true, disabled = false, hint = "" }) {
  const [visible, setVisible] = useState(false);

  return (
    <label>
      <span>{label}</span>
      <div className="password-field">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={event => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible(current => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          disabled={disabled}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export default function AuthPanel({
  supabase,
  onClose,
  initialMode = "sign-in",
  contextNote = "",
  recoveryStatus = AUTH_STATUS.ANONYMOUS,
  recoveryError = "",
  onCompleteReset,
  onCancelRecovery,
  onSwitchToAuthMode
}) {
  const recoveryActive = isRecoveryStatus(recoveryStatus);
  const [mode, setMode] = useState(recoveryActive ? "reset" : initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const recoveryCooldown = useEmailCooldown("recovery");
  const verificationCooldown = useEmailCooldown("verification");

  useEffect(() => {
    if (recoveryStatus === AUTH_STATUS.RECOVERY_VALIDATING || recoveryStatus === AUTH_STATUS.RECOVERY_READY || recoveryStatus === AUTH_STATUS.RECOVERY_ERROR) {
      setMode("reset");
      setError("");
      setMessage("");
    }
  }, [recoveryStatus]);

  const isRecoveryValidating = recoveryStatus === AUTH_STATUS.RECOVERY_VALIDATING && mode === "reset";
  const isRecoveryError = recoveryStatus === AUTH_STATUS.RECOVERY_ERROR && mode === "reset";
  const isReset = (recoveryStatus === AUTH_STATUS.RECOVERY_READY || recoveryStatus === AUTH_STATUS.RECOVERY_SUBMITTING) && mode === "reset";
  const isRegister = !recoveryActive && mode === "register";
  const isRecoveryRequest = mode === "recovery";
  const isVerifyEmail = !recoveryActive && mode === "verify-email";

  function switchMode(nextMode) {
    setMode(nextMode);
    setError("");
    setMessage("");
    setPassword("");
    setConfirmPassword("");
  }

  async function handleDismiss() {
    if (busy || recoveryStatus === AUTH_STATUS.RECOVERY_SUBMITTING) return;
    if (recoveryActive) {
      await onCancelRecovery?.();
    }
    onClose("dismissed");
  }

  async function handleRequestNewLinkFromError() {
    onSwitchToAuthMode?.("recovery");
    await onCancelRecovery?.();
    switchMode("recovery");
  }

  async function handleBackToSignInFromError() {
    onSwitchToAuthMode?.("sign-in");
    await onCancelRecovery?.();
    switchMode("sign-in");
  }

  async function handleResendVerification() {
    if (!email.trim() || verificationCooldown.active) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin }
      });
      if (resendError) throw resendError;
      const next = verificationCooldown.triggerCooldown();
      const waitLabel = formatCooldownDuration(next.durationMs);
      setMessage(
        next.attempts > 1
          ? `If that address is awaiting verification, a new verification email has been sent. Repeated request — next link available in ${waitLabel}.`
          : `If that address is awaiting verification, a new verification email has been sent. You can request another in ${waitLabel}.`
      );
    } catch (resendFailure) {
      if (isEmailRateLimitError(resendFailure)) {
        const next = verificationCooldown.triggerCooldown();
        setError(`Email rate limit reached. Please wait ${formatCooldownDuration(next.durationMs)} before requesting another verification link.`);
      } else {
        setError(normalizeAuthError(resendFailure, "register"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (isRecoveryRequest && recoveryCooldown.active) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (isReset) {
        const validation = validateNewPassword(password, confirmPassword);
        if (!validation.valid) {
          setError(validation.error);
          return;
        }
        await onCompleteReset(password);
        setPassword("");
        setConfirmPassword("");
        onClose("authenticated");
      } else if (isRecoveryRequest) {
        const cleanEmail = email.trim();
        if (!cleanEmail) {
          setError("Enter the email address associated with your account.");
          return;
        }
        const { error: requestError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: getRecoveryRedirectUrl(window.location.origin)
        });
        if (requestError) throw requestError;
        const next = recoveryCooldown.triggerCooldown();
        const waitLabel = formatCooldownDuration(next.durationMs);
        // Neutral message: never reveal whether an email address is registered.
        setMessage(
          next.attempts > 1
            ? `If an account exists for that email, a password reset link is on its way. Repeated request — next link available in ${waitLabel}.`
            : `If an account exists for that email, a password reset link is on its way. Check your inbox and spam folder. Next link available in ${waitLabel}.`
        );
      } else if (isRegister) {
        const validation = validateNewPassword(password, confirmPassword);
        if (!validation.valid) {
          setError(validation.error);
          return;
        }
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName.trim().slice(0, 80) }
          }
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          onClose("authenticated");
          return;
        }
        verificationCooldown.triggerCooldown();
        setMode("verify-email");
        setPassword("");
        setConfirmPassword("");
        setMessage("Account created. Check your inbox to verify your email before signing in.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (signInError) throw signInError;
        setPassword("");
        onClose("authenticated");
      }
    } catch (submitError) {
      const ctx = isReset ? "reset" : isRegister ? "register" : isRecoveryRequest ? "recovery" : "sign-in";
      if (isRecoveryRequest && isEmailRateLimitError(submitError)) {
        const next = recoveryCooldown.triggerCooldown();
        setError(`Email rate limit reached. Please wait ${formatCooldownDuration(next.durationMs)} before requesting another reset link.`);
      } else {
        setError(normalizeAuthError(submitError, ctx));
      }
    } finally {
      setBusy(false);
    }
  }

  const title = isRecoveryValidating
    ? "Verifying reset link"
    : isRecoveryError
      ? "Reset link unavailable"
      : isReset
        ? "Choose a new password"
        : isVerifyEmail
          ? "Verify your email"
          : isRecoveryRequest
            ? "Reset your password"
            : isRegister
              ? "Create your account"
              : "Welcome back";

  const subtitle = isRecoveryValidating
    ? "Checking your password recovery session with Supabase Auth."
    : isRecoveryError
      ? "For security, password reset links are single-use and expire shortly after they are sent."
      : isReset
        ? "Set a strong new password for your SeasonFetch account. Skipping or cancelling will sign out this temporary recovery session."
        : isVerifyEmail
          ? `We sent a confirmation link to ${email.trim() || "your email"}. Verify your address to sign in and sync your library.`
          : isRecoveryRequest
            ? "Enter your email and we will send a secure single-use link to choose a new password."
            : contextNote || "Sign in or create a free account to save movies and TV series, track statuses, and sync your library across devices.";

  const effectiveError = error || (isReset ? recoveryError : "");
  const isSubmitting = busy || recoveryStatus === AUTH_STATUS.RECOVERY_SUBMITTING;

  return (
    <div
      className="account-overlay"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && handleDismiss()}
    >
      <section className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <button
          className="account-close"
          type="button"
          onClick={handleDismiss}
          disabled={isSubmitting}
          aria-label="Close account panel"
        >
          ×
        </button>

        <span className="section-kicker">
          {recoveryActive ? "PASSWORD RECOVERY" : "SEASONFETCH ACCOUNT"}
        </span>
        <h2 id="account-title">{title}</h2>
        <p className="account-copy">{subtitle}</p>

        {isRecoveryValidating ? (
          <div className="auth-recovery-state">
            <div className="auth-loading-row">
              <span className="spinner spinner-dark" />
              <span>Validating recovery session…</span>
            </div>
            <button type="button" className="secondary-button account-submit" onClick={handleDismiss}>
              Cancel recovery
            </button>
          </div>
        ) : isRecoveryError ? (
          <div className="auth-recovery-state">
            <p className="account-error">{recoveryError || "This password reset link has expired or is invalid."}</p>
            <button type="button" className="primary-button account-submit" onClick={handleRequestNewLinkFromError}>
              Request a new reset link
            </button>
            <button type="button" className="secondary-button account-submit" onClick={handleBackToSignInFromError}>
              Back to sign in
            </button>
          </div>
        ) : isVerifyEmail ? (
          <div className="auth-recovery-state">
            {error && <p className="account-error">{error}</p>}
            {message && <p className="account-message">{message}</p>}
            <button
              type="button"
              className="secondary-button account-submit"
              disabled={busy || verificationCooldown.active}
              onClick={handleResendVerification}
            >
              {busy
                ? "Sending…"
                : verificationCooldown.active
                  ? `Resend available in ${verificationCooldown.formattedRemaining}`
                  : "Resend verification email"}
            </button>
            {verificationCooldown.active && (
              <small className="field-hint">
                Cooldown starts at 10 minutes and increases on repeated requests.
              </small>
            )}
            <button type="button" className="primary-button account-submit" onClick={() => switchMode("sign-in")}>
              Go to sign in
            </button>
          </div>
        ) : (
          <form className="account-form" onSubmit={submit}>
            {isRegister && (
              <label>
                <span>Display name</span>
                <input
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  disabled={isSubmitting}
                />
              </label>
            )}

            {!isReset && (
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  disabled={isSubmitting}
                />
              </label>
            )}

            {!isRecoveryRequest && (
              <PasswordInput
                label={isReset ? "New password" : "Password"}
                value={password}
                onChange={setPassword}
                autoComplete={isRegister || isReset ? "new-password" : "current-password"}
                minLength={isRegister || isReset ? 8 : 6}
                disabled={isSubmitting}
                hint={isRegister || isReset ? "At least 8 characters including a letter and a number." : ""}
              />
            )}

            {(isRegister || isReset) && (
              <PasswordInput
                label={isReset ? "Confirm new password" : "Confirm password"}
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                minLength={8}
                disabled={isSubmitting}
              />
            )}

            {effectiveError && <p className="account-error" role="alert">{effectiveError}</p>}
            {message && <p className="account-message" role="status">{message}</p>}

            <button
              className="primary-button account-submit"
              disabled={isSubmitting || (isRecoveryRequest && recoveryCooldown.active)}
              type="submit"
            >
              {isSubmitting
                ? "Please wait…"
                : isReset
                  ? "Update password"
                  : isRecoveryRequest
                    ? (recoveryCooldown.active ? `Wait ${recoveryCooldown.formattedRemaining}` : "Send reset link")
                    : isRegister
                      ? "Create account"
                      : "Sign in"}
            </button>
            {isRecoveryRequest && recoveryCooldown.active && (
              <small className="field-hint">
                Cooldown starts at 10 minutes and increases each time a link is requested repeatedly.
              </small>
            )}

            {isReset && (
              <button
                type="button"
                className="secondary-button account-submit"
                disabled={isSubmitting}
                onClick={handleDismiss}
              >
                Cancel &amp; sign out
              </button>
            )}
          </form>
        )}

        {!recoveryActive && !isVerifyEmail && (
          <div className="account-links">
            {!isRecoveryRequest && (
              <button type="button" onClick={() => switchMode("recovery")}>Forgot password?</button>
            )}
            {!isRecoveryRequest && (
              <button type="button" onClick={() => switchMode(isRegister ? "sign-in" : "register")}>
                {isRegister ? "Already have an account? Sign in" : "Create an account"}
              </button>
            )}
            {isRecoveryRequest && (
              <button type="button" onClick={() => switchMode("sign-in")}>Back to sign in</button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
