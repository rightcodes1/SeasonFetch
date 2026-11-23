import { addDownloadSelections } from '../utils/downloadSelection.js';

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function referenceNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function referenceLabel(reference) {
  if (reference.type === 'movie') return `Movie · ${text(reference.mediaTitle, 'Untitled movie')}`;
  const season = referenceNumber(reference.season);
  const episode = referenceNumber(reference.episode);
  const seasonLabel = season === null ? '?' : String(season).padStart(2, '0');
  const episodeLabel = episode === null ? '?' : String(episode).padStart(2, '0');
  const episodeTitle = text(reference.episodeTitle);
  return `${text(reference.mediaTitle, 'Untitled series')} · S${seasonLabel}E${episodeLabel}${episodeTitle ? ` · ${episodeTitle}` : ''}`;
}

// Use the same validation and deduplication as clipboard serialization, so
// the displayed count cannot include entries that will not be copied.
function uniqueSelections(selections) {
  return addDownloadSelections(Array.isArray(selections) ? selections : [], []).map(selection => ({
    ...selection,
    title: text(selection.title, 'Untitled release'),
    references: selection.references
  }));
}

export default function DownloadTray(props = {}) {
  const { selections, onRemove, onClear, onCopy, message } = props && typeof props === 'object' ? props : {};
  const downloads = uniqueSelections(selections);
  const count = downloads.length;
  const statusMessage = text(message);

  return (
    <section className="download-tray" aria-label="Download tray">
      <div className="download-tray-heading">
        <div>
          <span className="section-kicker">YOUR SELECTIONS</span>
          <h2>Download tray</h2>
          <p className="download-tray-count">{count} unique {count === 1 ? 'download' : 'downloads'}</p>
        </div>
        <div className="download-tray-actions">
          <button className="secondary-button" type="button" disabled={!count || typeof onClear !== 'function'} onClick={() => onClear()}>Clear tray</button>
          <button className="primary-button" type="button" disabled={!count || typeof onCopy !== 'function'} onClick={() => onCopy()}>Copy magnets</button>
        </div>
      </div>

      <p className="download-tray-intro">Saved releases are snapshots. Manual selection changes update already-trayed episodes currently displayed; selections from other seasons remain snapshots. After a new scan, add a release again to refresh its saved snapshot. Removing a download removes all episode references shown under it.</p>
      <div className={`download-tray-status${statusMessage ? ' has-message' : ''}`} role="status" aria-live="polite">{statusMessage}</div>

      {count ? (
        <ul className="download-tray-list">
          {downloads.map(download => (
            <li className="download-tray-item" key={download.key}>
              <div className="download-tray-item-content">
                <strong className="download-tray-release">{download.title}</strong>
                {download.references.length ? (
                  <ul className="download-tray-references">
                    {download.references.map((reference, index) => (
                      <li key={index}>
                        <span>{referenceLabel(reference)}</span>
                        {reference.type === 'episode' && reference.manuallySelected === true && <span className="download-tray-manual">Manually selected</span>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="download-tray-no-references">No episode or movie details provided.</p>}
              </div>
              <button
                className="secondary-button download-tray-remove"
                type="button"
                disabled={typeof onRemove !== 'function'}
                aria-label={`Remove ${download.title} from download tray`}
                onClick={() => onRemove(download.key)}
              >Remove</button>
            </li>
          ))}
        </ul>
      ) : <p className="download-tray-empty">No downloads selected yet. Add a release to prepare it here.</p>}

      <div className="download-tray-notes">
        <p>Copying prepares magnet links on your clipboard only; it does not queue transfers. Import or paste the entries into Free Download Manager (FDM) if your installed version supports it. Multi-magnet clipboard import in current FDM 6.x has not been verified.</p>
        <p>The <code>so</code> file-selection parameter depends on the downloader and its compatibility with FDM is unknown. FDM may treat multiple file indices from the same torrent as one torrent; verify the selected files in FDM.</p>
      </div>
    </section>
  );
}
