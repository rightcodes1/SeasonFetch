import { getReleaseIdentity, isValidReleaseMagnet } from '../utils/releaseSelection.js';

function audioSummary(candidate) {
  const language = candidate?.audio === 'english-dubbed'
    ? 'English dubbed'
    : candidate?.audio === 'dual-audio'
      ? 'Dual audio'
      : 'Language not reported';
  const evidence = candidate?.audioEvidence === 'explicit-english-dub'
    ? 'explicit English Dub metadata'
    : candidate?.audioEvidence === 'possible-english-audio'
      ? 'possible English audio'
      : 'unverified';
  return `${language} · ${evidence}`;
}

function safeSourceUrl(candidate) {
  const value = candidate?.sourceUrl || candidate?.externalUrl;
  if (typeof value !== 'string' || !value) return '';

  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    if (url.protocol === 'magnet:' && isValidReleaseMagnet(value, candidate?.infoHash)) return value;
  } catch {
    return '';
  }
  return '';
}

function qualityLabel(candidate) {
  const quality = [candidate?.resolution, candidate?.codec, candidate?.hdr].filter(value => typeof value === 'string' && value);
  return quality.length ? quality.join(' · ') : 'Not reported';
}

export default function ReleaseComparison({ item, onSelect, onRestore, mediaLabel = 'episode' }) {
  const candidates = Array.isArray(item?.candidates) ? item.candidates : [];
  const mediaDescription = mediaLabel === 'movie' ? 'this movie' : `episode ${item?.number}`;

  return (
    <section className="alternatives-panel release-comparison" aria-label={`Release comparison for ${mediaDescription}`}>
      <div className="release-comparison-heading">
        <div className="alternatives-heading">
          <span className="detail-label">ALL AVAILABLE CANDIDATES</span>
          <span>{candidates.length} after active filters</span>
        </div>
        {item.manualSelectionId && item.recommendedSource && (
          <button className="secondary-button small-button" type="button" onClick={onRestore}>
            Restore automatic recommendation
          </button>
        )}
      </div>

      <p className="release-comparison-note">
        Manual choices change the active source only; they do not verify the release or its contents.
      </p>

      {candidates.length ? (
        <div className="release-candidate-list">
          {candidates.map((candidate, index) => {
            const identity = getReleaseIdentity(candidate);
            const isRecommended = Boolean(identity && identity === item.recommendedSelectionId);
            const isActive = Boolean(identity && identity === item.activeSelectionId);
            const isManual = Boolean(identity && identity === item.manualSelectionId);
            const magnetIsValid = isValidReleaseMagnet(candidate?.magnet, candidate?.infoHash);
            const sourceUrl = safeSourceUrl(candidate);
            const provider = candidate?.provider || candidate?.name || '';
            const seeders = Number.isSafeInteger(candidate?.seeders) && candidate.seeders >= 0
              ? candidate.seeders.toLocaleString()
              : 'Not reported';

            return (
              <article
                className={`release-candidate${isActive ? ' is-active' : ''}`}
                key={`${identity || 'candidate'}-${index}`}
              >
                <div className="release-candidate-heading">
                  <strong className="release-candidate-title">{candidate?.title || 'Title not provided'}</strong>
                  <div className="release-state-badges">
                    {isRecommended && <span className="release-state-badge is-recommended">Automatic recommendation</span>}
                    {isManual && <span className="release-state-badge is-manual">Selected manually</span>}
                    {isActive && <span className="release-state-badge is-active-badge">Active source</span>}
                  </div>
                </div>

                <div className="release-candidate-meta">
                  <span><b>Quality</b>{qualityLabel(candidate)}</span>
                  <span><b>Size</b>{candidate?.sizeLabel || 'Not reported'}</span>
                  <span><b>Seeders</b>{seeders}</span>
                  <span><b>Audio / evidence</b>{audioSummary(candidate)}</span>
                  <span><b>Release group</b>{candidate?.releaseGroup || 'Not reported'}</span>
                  <span><b>Provider</b>{provider || 'Not reported'}</span>
                  <span>
                    <b>Source</b>
                    {sourceUrl
                      ? <a href={sourceUrl} target="_blank" rel="noreferrer">Open source</a>
                      : 'Not provided'}
                  </span>
                </div>

                <div className="release-candidate-actions">
                  <button
                    className="secondary-button small-button"
                    type="button"
                    onClick={() => onSelect(candidate)}
                    disabled={!magnetIsValid || isActive}
                    title={!magnetIsValid ? 'A valid magnet matching this info hash is required.' : undefined}
                  >
                    {isActive ? 'Current release' : 'Use this release'}
                  </button>
                  {!magnetIsValid && <span className="release-magnet-warning">No valid matching magnet; this candidate cannot be activated.</span>}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="release-empty">No release candidates were returned for {mediaDescription} after the active filters.</p>
      )}
    </section>
  );
}
