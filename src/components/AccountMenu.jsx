import { useEffect, useState } from "react";
import ProfilePanel from "./ProfilePanel.jsx";
import { getAvatarPresentation } from "../utils/profileAvatar.js";

export default function AccountMenu({
  supabase,
  user,
  profile,
  profileLoading = false,
  profileError = "",
  suspended = false,
  suspensionReason = "",
  isAdmin,
  libraryCounts,
  onAdmin,
  onSignOut,
  onProfileUpdated,
  onRetryProfile
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(null);

  // Close open dropdown/modals cleanly whenever the authenticated account changes.
  useEffect(() => {
    setOpen(false);
    setPanel(null);
  }, [user?.id]);

  useEffect(() => {
    function close(event) {
      if (!event.target.closest(".account-menu")) setOpen(false);
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const initial = (profile?.display_name || profile?.username || user.email || "U").slice(0, 1).toUpperCase();
  const avatarPath = profile?.avatar_path || "";
  const avatarUrl = avatarPath && !avatarPath.startsWith("preset:")
    ? supabase.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl
    : "";
  const avatarPresentation = getAvatarPresentation(avatarPath, avatarUrl);

  return (
    <>
      <div className="account-menu">
        {isAdmin && !suspended && (
          <button className="admin-trigger" type="button" onClick={() => { setOpen(false); onAdmin(); }}>
            ADMIN
          </button>
        )}
        <button
          className={`account-trigger ${suspended ? "is-suspended" : ""}`}
          type="button"
          onClick={() => setOpen(current => !current)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className="account-avatar">
            {avatarPresentation.type === "preset"
              ? avatarPresentation.mark
              : avatarPresentation.type === "image"
                ? <img src={avatarPresentation.url} alt="" />
                : initial}
          </span>
          <span>{profile?.display_name || profile?.username || user.email}</span>
          <span className="account-chevron">⌄</span>
        </button>

        {open && (
          <div className="account-dropdown" role="menu">
            <div className="dropdown-identity">
              <span className="section-kicker">{suspended ? "ACCOUNT SUSPENDED" : "SIGNED IN AS"}</span>
              <strong>{user.email}</strong>
            </div>
            <button type="button" onClick={() => { setPanel("profile"); setOpen(false); }}>Profile overview</button>
            {!suspended && (
              <button type="button" onClick={() => { setPanel("edit"); setOpen(false); }}>Edit profile</button>
            )}
            <button type="button" onClick={() => { setPanel("settings"); setOpen(false); }}>Account settings</button>
            {!suspended && (
              <button type="button" onClick={() => { setPanel("privacy"); setOpen(false); }}>Privacy</button>
            )}
            <div className="dropdown-divider" />
            <button type="button" className="dropdown-signout" onClick={() => { setOpen(false); onSignOut(); }}>
              Sign out
            </button>
          </div>
        )}
      </div>

      {panel && (
        <ProfilePanel
          key={`${user.id}-${panel}`}
          supabase={supabase}
          user={user}
          profile={profile}
          profileLoading={profileLoading}
          profileError={profileError}
          suspended={suspended}
          suspensionReason={suspensionReason}
          mode={panel}
          libraryCounts={libraryCounts}
          onClose={() => setPanel(null)}
          onProfileUpdated={onProfileUpdated}
          onRetryProfile={onRetryProfile}
        />
      )}
    </>
  );
}
