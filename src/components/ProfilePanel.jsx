import { useMemo, useState } from 'react';
import { sendPasswordRecovery } from '../utils/accountActions.js';
import { avatarPathForSelection, getAvatarPresentation } from '../utils/profileAvatar.js';

const ACCENTS = ['purple', 'lilac', 'rose', 'blue', 'mint', 'gold'];
const PRESETS = ['SF', '★', '◈', '✦', '◉', '✧', '◆', '✺'];

export default function ProfilePanel({ supabase, user, profile, mode, onClose, onProfileUpdated }) {
  const [currentMode, setCurrentMode] = useState(mode);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [isPublic, setIsPublic] = useState(Boolean(profile?.is_public));
  const [accentColor, setAccentColor] = useState(profile?.accent_color || 'purple');
  const [avatarFrame, setAvatarFrame] = useState(profile?.avatar_frame || 'default');
  const [avatarPreset, setAvatarPreset] = useState(profile?.avatar_path?.startsWith('preset:') ? profile.avatar_path.slice(7) : 'SF');
  const [avatarPresetChanged, setAvatarPresetChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const memberSince = useMemo(() => new Date(user.created_at || profile?.created_at || Date.now()).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), [user.created_at, profile?.created_at]);
  const isEdit = currentMode === 'edit';
  const avatarPath = avatarPathForSelection(profile?.avatar_path, avatarPreset, avatarPresetChanged);
  const avatarPresentation = getAvatarPresentation(avatarPath, avatarPath.startsWith('preset:') ? '' : supabase.storage.from('avatars').getPublicUrl(avatarPath).data.publicUrl);

  async function requestPasswordRecovery() {
    setError(''); setMessage('');
    try {
      await sendPasswordRecovery(supabase.auth, user.email, window.location.origin);
      setMessage('A recovery link was sent to your email.');
    } catch (recoveryError) {
      setError(recoveryError.message || 'Unable to send a password recovery link.');
    }
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    const normalizedUsername = username.trim().toLowerCase();
    if (normalizedUsername && !/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setError('Username must be 3–24 letters, numbers, or underscores.'); setBusy(false); return;
    }
    try {
      const { data, error: saveError } = await supabase.from('profiles').upsert({
        id: user.id,
        display_name: displayName.trim(),
        username: normalizedUsername || null,
        bio: bio.trim().slice(0, 500),
        is_public: isPublic,
        accent_color: accentColor,
        avatar_frame: avatarFrame,
        avatar_path: avatarPath
      }).select().single();
      if (saveError) throw saveError;
      onProfileUpdated(data); setMessage('Profile saved.');
    } catch (saveError) {
      setError(saveError.message?.includes('profiles_username_lower_key') ? 'That username is already taken.' : saveError.message || 'Unable to save profile.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="profile-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="profile-panel" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <button className="account-close" onClick={onClose} aria-label="Close profile">×</button>
      <div className="profile-hero"><div className={`profile-avatar profile-accent-${accentColor} frame-${avatarFrame}`}>{avatarPresentation.type === 'preset' ? <span>{avatarPresentation.mark}</span> : avatarPresentation.type === 'image' ? <img src={avatarPresentation.url} alt="Profile avatar" /> : <span>{(displayName || username || 'U').slice(0, 1).toUpperCase()}</span>}</div><div><span className="section-kicker">SEASONFETCH PROFILE</span><h2 id="profile-title">{isEdit ? 'Edit profile' : currentMode === 'privacy' ? 'Privacy' : currentMode === 'settings' ? 'Account settings' : 'Profile overview'}</h2><p>{displayName || username || 'Set up your SeasonFetch identity'}</p></div></div>
      {currentMode === 'profile' && <div className="profile-stats"><div><strong>{memberSince}</strong><span>Member since</span></div><div><strong>0</strong><span>Watched series</span></div><div><strong>0</strong><span>Watch minutes</span></div></div>}
      {currentMode === 'settings' && <div className="profile-info-card"><span className="section-kicker">SECURITY</span><strong>{user.email}</strong><p>Password recovery and email changes are handled through Supabase Auth.</p><button className="secondary-button" type="button" onClick={requestPasswordRecovery}>Send password recovery link</button>{error && <p className="account-error">{error}</p>}{message && <p className="account-message">{message}</p>}</div>}
      {currentMode === 'privacy' && <div className="profile-info-card"><span className="section-kicker">PROFILE VISIBILITY</span><p>Private profiles are hidden from public profile lookups. Turn this on only if you want other visitors to see your profile and public avatar.</p></div>}
      {(isEdit || mode === 'privacy') && <form className="profile-form" onSubmit={save}>
        {isEdit && <><label>Display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} /></label><label>Username<input value={username} onChange={event => setUsername(event.target.value)} placeholder="your_handle" maxLength={24} /></label><label>Bio<textarea value={bio} onChange={event => setBio(event.target.value)} maxLength={500} rows={3} /></label><div><span className="profile-field-label">Avatar mark</span><div className="preset-row">{PRESETS.map(preset => <button className={`preset ${avatarPreset === preset ? 'selected' : ''}`} type="button" key={preset} onClick={() => { setAvatarPreset(preset); setAvatarPresetChanged(true); }}>{preset}</button>)}</div></div><div><span className="profile-field-label">Accent</span><div className="accent-row">{ACCENTS.map(color => <button className={`accent-swatch ${color} ${accentColor === color ? 'selected' : ''}`} type="button" key={color} onClick={() => setAccentColor(color)} aria-label={`${color} accent`} />)}</div></div></>}
        <label className="privacy-toggle"><input type="checkbox" checked={isPublic} onChange={event => setIsPublic(event.target.checked)} /><span><strong>Public profile</strong><small>Allow other visitors to view this profile and avatar.</small></span></label>
        {error && <p className="account-error">{error}</p>}{message && <p className="account-message">{message}</p>}
        <button className="primary-button account-submit" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save changes'}</button>
      </form>}
      {currentMode === 'profile' && <button className="primary-button profile-edit-button" onClick={() => setCurrentMode('edit')}>Edit profile</button>}
    </section>
  </div>;
}
