import { useState } from 'react';

export default function AuthPanel({ supabase, onClose, initialMode = 'sign-in', contextNote = '' }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isRegister = mode === 'register';
  const isRecovery = mode === 'recovery';
  const isReset = mode === 'reset';

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (isReset) {
        if (password.length < 6) throw new Error('Your new password must be at least 6 characters.');
        if (password !== confirmPassword) throw new Error('The new passwords do not match.');
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        setMessage('Password updated. You are now signed in.');
        setPassword('');
        setConfirmPassword('');
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (isRecovery) {
        const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin
        });
        if (recoveryError) throw recoveryError;
        setMessage('If an account exists for that email, a recovery link is on its way.');
      } else if (isRegister) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName.trim() } }
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          onClose('authenticated');
          return;
        }
        setMessage('Account created. Check your email to confirm it.');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        onClose('authenticated');
      }
    } catch (submitError) {
      setError(submitError.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <button className="account-close" onClick={onClose} aria-label="Close account panel">×</button>
        <span className="section-kicker">SEASONFETCH ACCOUNT</span>
        <h2 id="account-title">{isReset ? 'Choose a new password' : isRecovery ? 'Recover access' : isRegister ? 'Create your profile' : 'Welcome back'}</h2>
        <p className="account-copy">{isReset ? 'Set a new password for your SeasonFetch account.' : isRecovery ? 'We’ll send a secure recovery link to your email.' : contextNote || 'Sign in or create a free account to save movies and TV series, track statuses, and sync your library across devices.'}</p>
        <form className="account-form" onSubmit={submit}>
          {isRegister && <label>Display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" /></label>}
          {!isReset && <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label>}
          {!isRecovery && <label>{isReset ? 'New password' : 'Password'}<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={isRegister || isReset ? 'new-password' : 'current-password'} minLength={6} required /></label>}
          {isReset && <label>Confirm new password<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={6} required /></label>}
          {error && <p className="account-error">{error}</p>}
          {message && <p className="account-message">{message}</p>}
          <button className="primary-button account-submit" disabled={busy} type="submit">{busy ? 'Please wait…' : isReset ? 'Set new password' : isRecovery ? 'Send recovery link' : isRegister ? 'Create account' : 'Sign in'}</button>
        </form>
        <div className="account-links">
          {!isRecovery && !isReset && <button onClick={() => setMode('recovery')}>Forgot password?</button>}
          {!isRecovery && !isReset && <button onClick={() => setMode(isRegister ? 'sign-in' : 'register')}>{isRegister ? 'Already have an account? Sign in' : 'Create an account'}</button>}
          {(isRecovery || isReset) && <button onClick={() => setMode('sign-in')}>Back to sign in</button>}
        </div>
      </section>
    </div>
  );
}
