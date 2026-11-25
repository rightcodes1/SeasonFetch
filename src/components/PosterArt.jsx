const ACCENTS = ["purple", "orange", "blue", "red"];

export function derivePosterPresentation(media, index = 0) {
  const title = media?.title || "Unknown title";
  const accent = media?.accent || ACCENTS[Math.abs(index) % ACCENTS.length];
  const initials = media?.initials
    || title.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase()
    || "SF";
  const posterLabel = media?.posterLabel || (media?.mediaType === "movie" ? "Movie" : "Series");
  const poster = media?.poster || media?.posterUrl || null;
  return { title, accent, initials, posterLabel, poster };
}

export default function PosterArt({ media, large = false, card = false, index = 0 }) {
  const { title, accent, initials, posterLabel, poster } = derivePosterPresentation(media, index);
  const sizeClass = large ? "poster-art-large" : card ? "poster-art-library" : "";

  return (
    <div className={`poster-art ${accent} ${sizeClass}`.trim()} aria-label={`${title} poster artwork`}>
      {poster && (
        <img
          className="poster-image"
          src={poster}
          alt=""
          loading={large ? "eager" : "lazy"}
          onError={event => event.currentTarget.remove()}
        />
      )}
      <div className="poster-noise" />
      <span className="poster-mark">{initials}</span>
      <span className="poster-caption">{posterLabel}</span>
      <span className="poster-edge">SEASONFETCH / 01</span>
    </div>
  );
}
