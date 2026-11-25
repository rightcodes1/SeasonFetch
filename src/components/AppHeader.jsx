import AccountMenu from "./AccountMenu.jsx";
import { APP_SECTIONS } from "../utils/navigation.js";

export default function AppHeader({
  activeSection,
  onNavigate,
  onResetBrand,
  libraryCount = 0,
  user,
  supabase,
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
  onRetryProfile,
  onSignIn
}) {
  return (
    <header className="topbar platform-topbar">
      <div className="topbar-left">
        <button className="brand" type="button" onClick={onResetBrand} aria-label="Reset SeasonFetch">
          <span className="brand-glyph"><span /></span>
          <span>Season<span className="accent-text">Fetch</span></span>
        </button>

        <nav className="primary-nav" aria-label="Primary navigation">
          {APP_SECTIONS.map(section => {
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`nav-tab ${isActive ? "is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onNavigate(section.id)}
              >
                <span>{section.label}</span>
                {section.id === "library" && user && libraryCount > 0 && (
                  <span className="nav-count" aria-label={`${libraryCount} saved titles`}>{libraryCount}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="topbar-right">
        <span className="live-indicator"><i /> Live discovery</span>
        {user ? (
          <AccountMenu
            supabase={supabase}
            user={user}
            profile={profile}
            profileLoading={profileLoading}
            profileError={profileError}
            suspended={suspended}
            suspensionReason={suspensionReason}
            isAdmin={isAdmin}
            libraryCounts={libraryCounts}
            onAdmin={onAdmin}
            onSignOut={onSignOut}
            onProfileUpdated={onProfileUpdated}
            onRetryProfile={onRetryProfile}
          />
        ) : (
          <button className="account-trigger account-sign-in" type="button" onClick={onSignIn}>
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
