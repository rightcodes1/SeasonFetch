import { useState } from 'react';

export default function AuthPanel({ supabase, onClose }) {
  const [mode, setMode] = useState('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isRegister = mode === 'register';
  const isRecovery = mode === 'recovery';

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (isRecovery) {
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
        setMessage(data.session ? 'Account created.' : 'Account created. Check your email to confirm it.');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        onClose();
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
        <h2 id="account-title">{isRecovery ? 'Recover access' : isRegister ? 'Create your profile' : 'Welcome back'}</h2>
        <p className="account-copy">{isRecovery ? 'We’ll send a secure recovery link to your email.' : 'Optional accounts add profile features without changing public search or Torrentio access.'}</p>
        <form className="account-form" onSubmit={submit}>
          {isRegister && <label>Display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" /></label>}
          <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label>
          {!isRecovery && <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={6} required /></label>}
          {error && <p className="account-error">{error}</p>}
          {message && <p className="account-message">{message}</p>}
          <button className="primary-button account-submit" disabled={busy} type="submit">{busy ? 'Please wait…' : isRecovery ? 'Send recovery link' : isRegister ? 'Create account' : 'Sign in'}</button>
        </form>
        <div className="account-links">
          {!isRecovery && <button onClick={() => setMode('recovery')}>Forgot password?</button>}
          {!isRecovery && <button onClick={() => setMode(isRegister ? 'sign-in' : 'register')}>{isRegister ? 'Already have an account? Sign in' : 'Create an account'}</button>}
          {isRecovery && <button onClick={() => setMode('sign-in')}>Back to sign in</button>}
        </div>
      </section>
    </div>
  );
}
