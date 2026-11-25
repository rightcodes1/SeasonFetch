import { useMemo, useState } from "react";
import { LIBRARY_STATUSES } from "../../shared/libraryConstants.js";
import { filterLibraryItems, libraryItemKey } from "../utils/libraryState.js";
import PosterArt from "./PosterArt.jsx";

const STATUS_TABS = [
  { id: "all", label: "All" },
  { id: "watching", label: "Watching" },
  { id: "want_to_watch", label: "Want to Watch" },
  { id: "completed", label: "Completed" },
  { id: "dropped", label: "Dropped" },
  { id: "favorites", label: "Favorites" }
];

const MEDIA_FILTERS = [
  { id: "all", label: "All types" },
  { id: "movie", label: "Movies" },
  { id: "series", label: "TV Series" }
];

function HeartIcon({ filled }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.5 4.8 13.7a4.9 4.9 0 0 1 6.9-7L12 7l.3-.3a4.9 4.9 0 0 1 6.9 7L12 20.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function tabCount(tabId, counts) {
  if (!counts) return 0;
  if (tabId === "all") return counts.total;
  if (tabId === "favorites") return counts.favorites;
  return counts.byStatus?.[tabId] || 0;
}

export default function LibraryView({
  user,
  authConfigured,
  suspended = false,
  suspensionReason = "",
  items = [],
  counts,
  loading = false,
  error = "",
  busyKeys = {},
  onRetry,
  onOpenTitle,
  onUpdateStatus,
  onToggleFavorite,
  onRemove,
  onGoDiscover,
  onRequestSignIn
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [mediaFilter, setMediaFilter] = useState("all");

  const visibleItems = useMemo(
    () => filterLibraryItems(items, { statusFilter, mediaFilter }),
    [items, statusFilter, mediaFilter]
  );

  if (!user) {
    return (
      <section className="library-section fade-in" aria-label="Personal library">
        <div className="empty-state library-empty-card">
          <div className="empty-orbit"><BookmarkIcon /></div>
          <span className="section-kicker">PERSONAL LIBRARY</span>
          <h2>Your personal movie &amp; TV home</h2>
          <p>
            Save movies and TV series, organize what you want to watch, mark favorites, and pick up cleanly on any device. Public search and source scanning remain available without an account.
          </p>
          <div className="library-cta-row">
            {authConfigured && (
              <button type="button" className="primary-button" onClick={onRequestSignIn}>
                Sign in to open My Library <ArrowIcon />
              </button>
            )}
            <button type="button" className="secondary-button" onClick={onGoDiscover}>
              Continue discovering
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (suspended) {
    return (
      <section className="library-section fade-in" aria-label="Personal library">
        <div className="empty-state library-empty-card">
          <div className="empty-orbit"><BookmarkIcon /></div>
          <span className="section-kicker">ACCOUNT SUSPENDED</span>
          <h2>Personal Library is currently restricted</h2>
          <p>
            {suspensionReason
              ? `Reason: ${suspensionReason}. Public movie and TV discovery remains available.`
              : "Your account is currently suspended. Personal Library actions are disabled while public movie and TV discovery remains available."}
          </p>
          <div className="library-cta-row">
            <button type="button" className="secondary-button" onClick={onGoDiscover}>
              Continue discovering
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="library-section fade-in" aria-label="My Library">
      <div className="library-header">
        <div className="library-header-copy">
          <span className="section-kicker">PERSONAL LIBRARY</span>
          <h1>My Library</h1>
          <p>
            Track what you want to watch, what is in rotation, and the favorites worth returning to.
          </p>
        </div>
        <div className="library-header-actions">
          <button type="button" className="primary-button" onClick={onGoDiscover}>
            Discover titles <ArrowIcon />
          </button>
        </div>
      </div>

      <div className="library-stats-strip" aria-label="Library overview">
        <div className="library-stat-card">
          <span>SAVED</span>
          <strong>{counts?.total || 0}</strong>
        </div>
        <div className="library-stat-card">
          <span>WATCHING</span>
          <strong>{counts?.byStatus?.watching || 0}</strong>
        </div>
        <div className="library-stat-card">
          <span>WANT TO WATCH</span>
          <strong>{counts?.byStatus?.want_to_watch || 0}</strong>
        </div>
        <div className="library-stat-card">
          <span>COMPLETED</span>
          <strong>{counts?.byStatus?.completed || 0}</strong>
        </div>
        <div className="library-stat-card">
          <span>FAVORITES</span>
          <strong>{counts?.favorites || 0}</strong>
        </div>
      </div>

      <div className="library-toolbar">
        <div className="library-status-tabs" role="tablist" aria-label="Filter library by watch status">
          {STATUS_TABS.map(tab => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`library-filter-tab ${active ? "is-active" : ""}`}
                onClick={() => setStatusFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <b>{tabCount(tab.id, counts)}</b>
              </button>
            );
          })}
        </div>

        <div className="library-media-filter" role="group" aria-label="Filter library by media type">
          {MEDIA_FILTERS.map(option => (
            <button
              key={option.id}
              type="button"
              aria-pressed={mediaFilter === option.id}
              onClick={() => setMediaFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="library-error-banner" role="alert">
          <div>
            <strong>Unable to sync your library</strong>
            <span>{error}</span>
          </div>
          <button type="button" className="secondary-button small-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="loading-panel">
          <span className="spinner spinner-dark" />
          Loading your library
          <span className="loading-note">syncing saved movies and series</span>
        </div>
      ) : items.length === 0 && !error ? (
        <div className="empty-state library-empty-card">
          <div className="empty-orbit"><BookmarkIcon /></div>
          <span className="section-kicker">EMPTY LIBRARY</span>
          <h2>Save your first movie or series</h2>
          <p>
            Search for a show or film in Discover and hit Save. Your watchlist, statuses, and favorites will live right here across sessions and devices.
          </p>
          <div className="library-cta-row">
            <button type="button" className="primary-button" onClick={onGoDiscover}>
              Explore Discover <ArrowIcon />
            </button>
          </div>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="empty-state library-empty-card">
          <span className="section-kicker">NO MATCHING TITLES</span>
          <h2>Nothing in this view yet</h2>
          <p>Try another status filter or switch between Movies and TV Series.</p>
          <div className="library-cta-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() => { setStatusFilter("all"); setMediaFilter("all"); }}
            >
              Reset filters
            </button>
          </div>
        </div>
      ) : (
        <div className="library-grid">
          {visibleItems.map((item, index) => {
            const key = libraryItemKey(item.mediaType, item.imdbId);
            const busy = Boolean(busyKeys[key]);

            return (
              <article className="library-card" key={key}>
                <button
                  type="button"
                  className="library-card-main"
                  onClick={() => onOpenTitle(item)}
                  aria-label={`Open ${item.title}`}
                >
                  <PosterArt media={item} card index={index} />
                  <div className="library-card-body">
                    <div className="library-card-topline">
                      <span className="library-type-pill">{item.mediaType === "movie" ? "Movie" : "TV Series"}</span>
                      {item.rating && <span className="library-rating">★ {item.rating}</span>}
                    </div>
                    <h3>{item.title}</h3>
                    <p className="library-card-meta">
                      <span>{item.year || "Year unavailable"}</span>
                      {item.mediaType === "series" && Number.isInteger(item.seasonCount) && item.seasonCount > 0 && (
                        <>
                          <i />
                          <span>{item.seasonCount} {item.seasonCount === 1 ? "season" : "seasons"}</span>
                        </>
                      )}
                    </p>
                    {item.genres?.length > 0 && (
                      <div className="library-card-genres">
                        {item.genres.slice(0, 3).map(genre => <span key={genre}>{genre}</span>)}
                      </div>
                    )}
                  </div>
                </button>

                <div className="library-card-controls">
                  <div className="select-wrap library-card-status">
                    <select
                      value={item.status}
                      disabled={busy}
                      aria-label={`Watch status for ${item.title}`}
                      onChange={event => onUpdateStatus(item, event.target.value)}
                    >
                      {LIBRARY_STATUSES.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </div>

                  <button
                    type="button"
                    className={`library-icon-button ${item.isFavorite ? "is-favorited" : ""}`}
                    disabled={busy}
                    aria-pressed={Boolean(item.isFavorite)}
                    aria-label={item.isFavorite ? `Remove ${item.title} from favorites` : `Favorite ${item.title}`}
                    onClick={() => onToggleFavorite(item)}
                  >
                    <HeartIcon filled={Boolean(item.isFavorite)} />
                  </button>

                  <button
                    type="button"
                    className="library-icon-button library-icon-danger"
                    disabled={busy}
                    aria-label={`Remove ${item.title} from library`}
                    onClick={() => onRemove(item)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
