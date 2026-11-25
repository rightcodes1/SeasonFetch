import { useEffect, useState } from 'react';
import ProfilePanel from './ProfilePanel.jsx';
import { getAvatarPresentation } from '../utils/profileAvatar.js';

export default function AccountMenu({ supabase, user, profile, isAdmin, libraryCounts, onAdmin, onSignOut, onProfileUpdated }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(null);

  useEffect(() => {
    function close(event) {
      if (!event.target.closest('.account-menu')) setOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const initial = (profile?.display_name || profile?.username || user.email || 'U').slice(0, 1).toUpperCase();
  const avatarPath = profile?.avatar_path || '';
  const avatarUrl = avatarPath && !avatarPath.startsWith('preset:') ? supabase.storage.from('avatars').getPublicUrl(avatarPath).data.publicUrl : '';
  const avatarPresentation = getAvatarPresentation(avatarPath, avatarUrl);

  return <>
    <div className="account-menu">
      {isAdmin && <button className="admin-trigger" onClick={() => { setOpen(false); onAdmin(); }}>ADMIN</button>}
      <button className="account-trigger" onClick={() => setOpen(current => !current)} aria-expanded={open} aria-haspopup="menu">
        <span className="account-avatar">{avatarPresentation.type === 'preset' ? avatarPresentation.mark : avatarPresentation.type === 'image' ? <img src={avatarPresentation.url} alt="" /> : initial}</span><span>{profile?.display_name || profile?.username || user.email}</span><span className="account-chevron">⌄</span>
      </button>
      {open && <div className="account-dropdown" role="menu">
        <div className="dropdown-identity"><span className="section-kicker">SIGNED IN AS</span><strong>{user.email}</strong></div>
        <button onClick={() => { setPanel('profile'); setOpen(false); }}>Profile overview</button>
        <button onClick={() => { setPanel('edit'); setOpen(false); }}>Edit profile</button>
        <button onClick={() => { setPanel('settings'); setOpen(false); }}>Account settings</button>
        <button onClick={() => { setPanel('privacy'); setOpen(false); }}>Privacy</button>
        <div className="dropdown-divider" />
        <button className="dropdown-signout" onClick={onSignOut}>Sign out</button>
      </div>}
    </div>
    {panel && <ProfilePanel supabase={supabase} user={user} profile={profile} mode={panel} libraryCounts={libraryCounts} onClose={() => setPanel(null)} onProfileUpdated={onProfileUpdated} />}
  </>;
}
