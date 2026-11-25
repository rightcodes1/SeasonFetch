import { LIBRARY_STATUSES } from "../../shared/libraryConstants.js";

function BookmarkSvg({ filled = false }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function HeartSvg({ filled = false }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.5 4.8 13.7a4.9 4.9 0 0 1 6.9-7L12 7l.3-.3a4.9 4.9 0 0 1 6.9 7L12 20.5Z" />
    </svg>
  );
}

function TrashSvg() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

function ChevronDownSvg() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function SaveToLibraryControl({
  media,
  fallbackMediaType = "series",
  savedItem = null,
  busy = false,
  variant = "banner",
  onSave,
  onUpdateStatus,
  onToggleFavorite,
  onRemove
}) {
  const isSaved = Boolean(savedItem);

  if (variant === "card") {
    return (
      <div className="card-library-actions" onClick={event => event.stopPropagation()}>
        <button
          type="button"
          className={`library-chip-button ${isSaved ? "is-saved" : ""}`}
          disabled={busy}
          aria-pressed={isSaved}
          aria-label={isSaved ? `Remove ${media?.title || "title"} from library` : `Save ${media?.title || "title"} to library`}
          onClick={event => {
            event.stopPropagation();
            if (isSaved) onRemove(savedItem);
            else onSave(media, { fallbackMediaType });
          }}
        >
          <BookmarkSvg filled={isSaved} />
          <span>{busy ? "Saving…" : isSaved ? "Saved" : "Save"}</span>
        </button>

        {isSaved && (
          <button
            type="button"
            className={`library-icon-button ${savedItem.isFavorite ? "is-favorited" : ""}`}
            disabled={busy}
            aria-pressed={Boolean(savedItem.isFavorite)}
            aria-label={savedItem.isFavorite ? `Remove ${media?.title || "title"} from favorites` : `Favorite ${media?.title || "title"}`}
            onClick={event => {
              event.stopPropagation();
              onToggleFavorite(savedItem);
            }}
          >
            <HeartSvg filled={Boolean(savedItem.isFavorite)} />
          </button>
        )}
      </div>
    );
  }

  if (!isSaved) {
    return (
      <div className="banner-library-controls">
        <button
          type="button"
          className="secondary-button library-primary-save"
          disabled={busy}
          onClick={() => onSave(media, { fallbackMediaType })}
        >
          <BookmarkSvg />
          <span>{busy ? "Saving…" : "Save to library"}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="banner-library-controls is-saved">
      <div className="select-wrap library-status-select">
        <BookmarkSvg filled />
        <select
          value={savedItem.status}
          disabled={busy}
          aria-label={`Watch status for ${savedItem.title}`}
          onChange={event => onUpdateStatus(savedItem, event.target.value)}
        >
          {LIBRARY_STATUSES.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <ChevronDownSvg />
      </div>

      <button
        type="button"
        className={`secondary-button library-favorite-button ${savedItem.isFavorite ? "is-favorited" : ""}`}
        disabled={busy}
        aria-pressed={Boolean(savedItem.isFavorite)}
        aria-label={savedItem.isFavorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => onToggleFavorite(savedItem)}
      >
        <HeartSvg filled={Boolean(savedItem.isFavorite)} />
        <span>{savedItem.isFavorite ? "Favorited" : "Favorite"}</span>
      </button>

      <button
        type="button"
        className="secondary-button library-remove-button"
        disabled={busy}
        aria-label={`Remove ${savedItem.title} from library`}
        onClick={() => onRemove(savedItem)}
      >
        <TrashSvg />
        <span>Remove</span>
      </button>
    </div>
  );
}
