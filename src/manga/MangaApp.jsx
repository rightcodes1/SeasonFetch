import { useCallback, useEffect, useMemo, useState } from 'react';
import { createMockMangaProvider } from './mockProvider.js';
import { sortChapters, sortPages } from './chapterOrdering.js';
import { chapterStorageKey, createMangaStorage } from './storage.js';
import { createMangaDownloadManager } from './downloadManager.js';
import { getReaderRetryTarget, restoreReadingPosition } from './readerProgress.js';
import './manga.css';

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Unavailable';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function chapterNumberLabel(chapter) {
  return chapter.number == null ? 'Bonus chapter' : `Chapter ${chapter.number}`;
}

function jobPercent(job) {
  if (!job?.totalPages) return 0;
  return Math.min(100, Math.round((job.completedPages?.length || 0) / job.totalPages * 100));
}

function Cover({ work, large = false }) {
  const initials = work.title.split(/\s+/).slice(0, 3).map(word => word[0]).join('').toUpperCase();
  return (
    <div className={`manga-cover${large ? ' manga-cover-large' : ''}`} style={{ '--cover-color': work.coverColor || '#51447e' }} aria-label={`${work.title} sample cover`}>
      <span className="manga-cover-orbit" />
      <strong>{initials}</strong>
      <small>SEASONFETCH · SAMPLE</small>
    </div>
  );
}

export default function MangaApp() {
  const provider = useMemo(() => createMockMangaProvider({ failures: { 'chapter-orbit-10:page:1': 1 } }), []);
  const storage = useMemo(() => createMangaStorage(), []);
  const manager = useMemo(() => createMangaDownloadManager(provider, storage), [provider, storage]);
  const [screen, setScreen] = useState('browse');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedWork, setSelectedWork] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [pages, setPages] = useState([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageAttempt, setPageAttempt] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [imageOffline, setImageOffline] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [bookmark, setBookmark] = useState(null);
  const [progress, setProgress] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [usage, setUsage] = useState({ usage: null, quota: null });
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(globalThis.navigator?.onLine !== false);
  const [persistent, setPersistent] = useState(null);

  const applyJobUpdate = useCallback(job => {
    setJobs(current => [...current.filter(item => item.chapterKey !== job.chapterKey), job].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
  }, []);

  const refreshStorage = useCallback(async () => {
    try {
      const [nextJobs, nextUsage] = await Promise.all([storage.listDownloadJobs(), storage.getStorageEstimate()]);
      setJobs(nextJobs);
      setUsage(nextUsage);
      setStorageError('');
    } catch (error) {
      setStorageError(error.message || 'Browser storage could not be opened.');
    }
  }, [storage]);

  useEffect(() => {
    const updateNetworkState = () => setOnline(globalThis.navigator?.onLine !== false);
    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);
    return () => {
      window.removeEventListener('online', updateNetworkState);
      window.removeEventListener('offline', updateNetworkState);
    };
  }, []);

  useEffect(() => {
    let active = true;
    provider.search('').then(items => { if (active) setResults(items); });
    (async () => {
      try {
        await refreshStorage();
        if (!active) return;
        setStorageReady(true);
        const resumed = await manager.resumeInterrupted({ onUpdate: applyJobUpdate });
        if (active && resumed.length) setNotice(`Resumed ${resumed.length} interrupted chapter download${resumed.length === 1 ? '' : 's'}.`);
        if (active) await refreshStorage();
      } catch (error) {
        if (active) setStorageError(error.message || 'Manga storage is unavailable.');
      }
    })();
    return () => { active = false; };
  }, [provider, manager, refreshStorage, applyJobUpdate]);

  async function searchCatalog(event) {
    event?.preventDefault();
    setSearching(true);
    setNotice('');
    try {
      setResults(await provider.search(query));
    } catch (error) {
      setNotice(error.message || 'The sample catalog could not be searched.');
    } finally {
      setSearching(false);
    }
  }

  async function openWork(work) {
    setScreen('details');
    setSelectedChapter(null);
    setChapters([]);
    setSelectedWork(work);
    setNotice('');
    try {
      const [details, workChapters] = await Promise.all([provider.getDetails(work.id), provider.getChapters(work.id)]);
      setSelectedWork(details);
      setChapters(sortChapters(workChapters));
    } catch (error) {
      setNotice(error.message || 'Unable to load sample details.');
    }
  }

  async function openReader(chapter) {
    setNotice('');
    setSelectedChapter(chapter);
    setScreen('reader');
    setPages([]);
    setPageIndex(0);
    setBookmark(null);
    setProgress(null);
    setImageUrl('');
    setPageError('');
    try {
      const nextPages = sortPages(await provider.getPages(chapter.id));
      if (!nextPages.length) throw new Error('No pages are available for this chapter.');
      const key = chapterStorageKey(chapter);
      const [savedProgress, savedBookmark] = await Promise.all([storage.getReadingProgress(key), storage.getBookmark(key)]);
      const restored = restoreReadingPosition(savedProgress, nextPages.length);
      const restoredProgress = { workId: chapter.workId, chapterId: chapter.id, ...restored };
      setPages(nextPages);
      setPageIndex(restored.pageIndex);
      setProgress(restoredProgress);
      setBookmark(savedBookmark);
      await storage.putReadingProgress(key, restoredProgress);
    } catch (error) {
      setPageError(error.message || 'Unable to open this sample chapter.');
    }
  }

  useEffect(() => {
    if (screen !== 'reader' || !selectedChapter || !pages[pageIndex]) return undefined;
    let active = true;
    let objectUrl = '';
    const currentPage = pages[pageIndex];
    const key = chapterStorageKey(selectedChapter);
    setPageLoading(true);
    setPageError('');
    setImageUrl('');
    (async () => {
      let blob = await storage.getDownloadedPage(key, currentPage.index);
      let fromOfflineDownload = Boolean(blob);
      if (!blob) blob = await storage.getCachedPage(key, currentPage.index);
      if (!blob) {
        if (!online) throw new Error('This page is not saved for offline reading. Download the chapter while online.');
        blob = await provider.getPageImage(currentPage);
        try {
          await storage.putCachedPage(key, currentPage, blob);
        } catch {
          // Reading remains available even if the temporary cache cannot be written.
        }
      }
      objectUrl = URL.createObjectURL(blob);
      if (active) {
        setImageUrl(objectUrl);
        setImageOffline(fromOfflineDownload || !online);
        setPageLoading(false);
      } else {
        URL.revokeObjectURL(objectUrl);
      }
    })().catch(error => {
      if (!active) return;
      setPageError(error.message || 'This page could not be loaded.');
      setPageLoading(false);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [screen, selectedChapter, pages, pageIndex, pageAttempt, provider, storage, online]);

  async function goToPage(nextIndex) {
    const clamped = Math.max(0, Math.min(nextIndex, pages.length - 1));
    setPageIndex(clamped);
    const key = chapterStorageKey(selectedChapter);
    const nextProgress = { workId: selectedChapter.workId, chapterId: selectedChapter.id, pageIndex: clamped, completed: clamped === pages.length - 1 };
    setProgress(nextProgress);
    try {
      await storage.putReadingProgress(key, nextProgress);
    } catch (error) {
      setStorageError(error.message || 'Reading progress could not be saved.');
    }
  }

  async function toggleBookmark() {
    const key = chapterStorageKey(selectedChapter);
    try {
      if (bookmark?.pageIndex === pageIndex) {
        await storage.deleteBookmark(key);
        setBookmark(null);
      } else {
        await storage.putBookmark(key, pageIndex);
        setBookmark({ pageIndex });
      }
    } catch (error) {
      setStorageError(error.message || 'Bookmark could not be saved.');
    }
  }

  async function startDownload(chapter) {
    setNotice('');
    try {
      const result = await manager.download(chapter, { onUpdate: applyJobUpdate });
      await refreshStorage();
      setNotice(result.status === 'complete' ? `${chapter.title} is saved for offline reading.` : result.error || 'Some pages need a retry.');
    } catch (error) {
      setNotice(error.message || 'The chapter download could not start.');
    }
  }

  async function retryDownload(job) {
    const chapter = chapters.find(item => item.id === job.chapterId) || {
      id: job.chapterId,
      sourceId: job.sourceId,
      workId: job.workId,
      title: job.chapterTitle,
      number: job.chapterNumber
    };
    await startDownload(chapter);
  }

  async function deleteDownload(job) {
    try {
      await manager.cancelAndWait(job.chapterKey);
      await storage.deleteDownloadedChapter(job.chapterKey);
      await refreshStorage();
    } catch (error) {
      setStorageError(error.message || 'Saved chapter could not be deleted.');
    }
  }

  async function openSavedChapter(job) {
    try {
      const [work, workChapters] = await Promise.all([provider.getDetails(job.workId), provider.getChapters(job.workId)]);
      const orderedChapters = sortChapters(workChapters);
      const chapter = orderedChapters.find(item => item.id === job.chapterId);
      if (!chapter) throw new Error('This saved chapter is no longer in the sample catalog.');
      setSelectedWork(work);
      setChapters(orderedChapters);
      await openReader(chapter);
    } catch (error) {
      setNotice(error.message || 'This saved chapter could not be opened.');
    }
  }

  async function clearCache() {
    try {
      await storage.clearTemporaryCache();
      await refreshStorage();
      setNotice('Temporary page cache cleared. Saved chapters were kept.');
    } catch (error) {
      setStorageError(error.message || 'Temporary cache could not be cleared.');
    }
  }

  async function requestPersistentStorage() {
    const persist = globalThis.navigator?.storage?.persist;
    if (typeof persist !== 'function') {
      setPersistent(false);
      return;
    }
    try {
      setPersistent(await persist.call(globalThis.navigator.storage));
    } catch {
      setPersistent(false);
    }
  }

  const selectedJob = selectedChapter ? jobs.find(job => job.chapterKey === chapterStorageKey(selectedChapter)) : null;
  const savedChapters = jobs.filter(job => (job.completedPages?.length || 0) > 0 || job.status === 'complete');
  const currentPage = pages[pageIndex];

  return (
    <div className="app-shell manga-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar manga-topbar">
        <a className="brand" href="#/series" aria-label="Return to SeasonFetch Series and Movies">
          <span className="brand-glyph"><span /></span>
          <span>Season<span className="accent-text">Fetch</span></span>
        </a>
        <nav className="manga-topbar-nav" aria-label="Manga navigation">
          <button className={screen === 'browse' || screen === 'details' ? 'is-active' : ''} onClick={() => { setScreen('browse'); setSelectedChapter(null); }}>Browse</button>
          <button className={screen === 'downloads' ? 'is-active' : ''} onClick={() => setScreen('downloads')}>Downloads <span>{savedChapters.length}</span></button>
          <a href="#/series">Series &amp; Movies</a>
        </nav>
      </header>

      <main className="manga-main">
        <div className="manga-page-heading">
          <div>
            <span className="section-kicker">SEASONFETCH / MANGA</span>
            <h1 className="manga-title">Read at your <span>own pace.</span></h1>
            <p className="manga-subtitle">A local sample catalog for exploring chapters, progress and offline reading.</p>
          </div>
          <div className="manga-demo-badge"><i /> MOCK CATALOG · NO LIVE SOURCES</div>
        </div>

        {!storageReady && <div className="manga-storage-alert">Opening this browser's private Manga library…</div>}
        {storageError && <div className="manga-storage-alert is-error" role="alert">{storageError}</div>}
        {notice && <div className="manga-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}

        {screen === 'browse' && <section className="manga-discovery">
          <form className="manga-search" onSubmit={searchCatalog}>
            <label htmlFor="manga-query">Find a story</label>
            <div className="manga-search-controls">
              <input id="manga-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the sample catalog" />
              <button className="primary-button" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
            </div>
            <span>Search runs locally against sample data; no external source is contacted.</span>
          </form>
          <div className="manga-section-heading"><div><span className="section-kicker">LOCAL SAMPLE LIBRARY</span><h2>{query.trim() ? 'Search results' : 'Stories to explore'}</h2></div><span>{results.length} titles</span></div>
          {results.length ? <div className="manga-work-grid">
            {results.map(work => <button className="manga-work-card" key={work.id} onClick={() => openWork(work)}>
              <Cover work={work} />
              <span className="manga-work-copy"><strong>{work.title}</strong><small>{work.year} <i /> {work.status} <i /> {work.genres.slice(0, 2).join(' · ')}</small><span>{work.description}</span><em>Open details <b>→</b></em></span>
            </button>)}
          </div> : <div className="manga-empty">No sample titles match that search. Try a title or genre.</div>}
        </section>}

        {screen === 'details' && selectedWork && <section className="manga-details">
          <button className="manga-back-link" onClick={() => setScreen('browse')}>← Back to catalog</button>
          <div className="manga-work-banner">
            <Cover work={selectedWork} large />
            <div className="manga-work-detail-copy"><span className="section-kicker">{selectedWork.status?.toUpperCase() || 'STATUS UNKNOWN'} · {selectedWork.year || 'YEAR UNKNOWN'}</span><h2>{selectedWork.title}</h2><p>{selectedWork.description}</p><div className="manga-tags">{selectedWork.genres.map(genre => <span key={genre}>{genre}</span>)}</div><small>{selectedWork.author ? `Story: ${selectedWork.author}` : ''}{selectedWork.author && selectedWork.artist ? ' · ' : ''}{selectedWork.artist ? `Art: ${selectedWork.artist}` : ''} · {selectedWork.volumes?.length || 0} volumes</small></div>
          </div>
          <div className="manga-section-heading manga-chapter-heading"><div><span className="section-kicker">CHAPTERS</span><h2>Choose a chapter</h2></div><span>{chapters.length} chapters · sorted numerically</span></div>
          <div className="manga-chapter-list">
            {chapters.map(chapter => {
              const job = jobs.find(item => item.chapterKey === chapterStorageKey(chapter));
              const percent = jobPercent(job);
              return <article className="manga-chapter-row" key={chapter.id}>
                <div className="manga-chapter-copy"><strong>{chapterNumberLabel(chapter)} <span>{chapter.title}</span></strong><small>{chapter.volumeNumber ? `Volume ${chapter.volumeNumber} · ` : ''}{chapter.pageCount} pages · {chapter.language.toUpperCase()} · {chapter.readingSource.name}</small>{job && <div className="manga-mini-progress"><span><i style={{ width: `${percent}%` }} /></span><small>{job.status === 'complete' ? 'Saved offline' : `${job.completedPages?.length || 0}/${job.totalPages} pages · ${job.status}`}</small></div>}</div>
                <div className="manga-chapter-actions"><button className="secondary-button small-button" onClick={() => openReader(chapter)}>Read</button>{job?.status === 'complete' ? <button className="manga-saved-pill" onClick={() => setScreen('downloads')}>Saved</button> : <button className="primary-button small-button" disabled={!storageReady} onClick={() => startDownload(chapter)}>{job?.status === 'partial' || job?.status === 'failed' ? 'Retry download' : job?.status === 'downloading' ? 'Downloading…' : 'Download'}</button>}</div>
              </article>;
            })}
          </div>
          {!chapters.length && <div className="manga-empty">No sample chapters are available for this title.</div>}
        </section>}

        {screen === 'reader' && selectedChapter && <section className="manga-reader">
          <div className="manga-reader-toolbar"><button className="manga-back-link" onClick={() => setScreen('details')}>← Chapters</button><div><span className="section-kicker">{selectedWork?.title || 'Manga'} · {chapterNumberLabel(selectedChapter)}</span><h2>{selectedChapter.title}</h2></div><button className={`manga-bookmark${bookmark?.pageIndex === pageIndex ? ' is-bookmarked' : ''}`} onClick={toggleBookmark} aria-pressed={bookmark?.pageIndex === pageIndex}>{bookmark?.pageIndex === pageIndex ? '★ Bookmarked' : '☆ Bookmark page'}</button></div>
          <div className="manga-reader-stage" aria-live="polite">
            {pageLoading && <div className="manga-reader-message">Loading page…</div>}
            {pageError && <div className="manga-reader-message is-error"><strong>Page unavailable</strong><span>{pageError}</span><button className="secondary-button small-button" onClick={() => { setOnline(globalThis.navigator?.onLine !== false); if (getReaderRetryTarget(pages.length) === 'chapter') void openReader(selectedChapter); else setPageAttempt(value => value + 1); }}>{getReaderRetryTarget(pages.length) === 'chapter' ? 'Retry chapter' : 'Retry page'}</button></div>}
            {imageUrl && <img src={imageUrl} alt={`${selectedChapter.title}, page ${pageIndex + 1}`} className="manga-page-image" />}
          </div>
          <div className="manga-reader-controls"><button className="secondary-button" disabled={pageIndex <= 0 || !pages.length} onClick={() => void goToPage(pageIndex - 1)}>← Previous</button><div><strong>Page {pages.length ? pageIndex + 1 : 0} <span>/ {pages.length}</span></strong><small>{imageOffline ? 'OFFLINE COPY' : online ? 'SAMPLE SOURCE' : 'TEMPORARY CACHE'}</small></div><button className="primary-button" disabled={pageIndex >= pages.length - 1 || !pages.length} onClick={() => void goToPage(pageIndex + 1)}>Next →</button></div>
          <div className="manga-reader-footnote">Progress saves as you move. {progress?.completed ? 'Chapter marked complete.' : selectedJob?.status === 'complete' ? 'This chapter is saved for offline reading.' : 'Download the chapter from its details page for offline reading.'}</div>
        </section>}

        {screen === 'downloads' && <section className="manga-downloads">
          <div className="manga-section-heading"><div><span className="section-kicker">THIS DEVICE</span><h2>Offline library</h2></div><span>{savedChapters.length} saved chapter{savedChapters.length === 1 ? '' : 's'}</span></div>
          <div className="manga-storage-panel"><div className="manga-storage-summary"><div><span className="summary-label">BROWSER STORAGE · APPROXIMATE</span><strong>{formatBytes(usage.usage)} <small>{usage.quota ? `/ ${formatBytes(usage.quota)}` : 'used / quota unavailable'}</small></strong></div><span className="manga-storage-note">Browser-managed storage can be cleared by the user or evicted when not persistent.</span></div><div className="manga-storage-actions"><button className="secondary-button small-button" onClick={() => void requestPersistentStorage()}>Request protected storage</button><button className="secondary-button small-button" onClick={() => void clearCache()}>Clear temporary cache</button></div>{persistent !== null && <small className="manga-persistence-result">{persistent ? 'Browser granted persistent storage; it can still be removed by clearing site data.' : 'Persistent storage was unavailable or not granted. Keep a backup of important pages.'}</small>}</div>
          {jobs.length ? <div className="manga-download-list">{jobs.map(job => {
            const percent = jobPercent(job);
            return <article className="manga-download-row" key={job.chapterKey}>
              <div className="manga-download-info"><div className="manga-download-title"><strong>{job.chapterTitle}</strong><span className={`manga-job-status is-${job.status}`}>{job.status}</span></div><small>{job.completedPages?.length || 0} of {job.totalPages} pages · {percent}%</small><div className="manga-progress-track"><i style={{ width: `${percent}%` }} /></div>{job.failedPages?.length > 0 && <p className="manga-job-error">Retryable pages: {job.failedPages.map(index => index + 1).join(', ')}. {job.error}</p>}</div>
              <div className="manga-download-actions">{job.status !== 'complete' && <button className="secondary-button small-button" disabled={!storageReady} onClick={() => void retryDownload(job)}>{job.status === 'downloading' ? 'Continue' : 'Retry failed pages'}</button>}{job.status === 'complete' && <button className="secondary-button small-button" onClick={() => void openSavedChapter(job)}>Read offline</button>}<button className="manga-delete-button" onClick={() => void deleteDownload(job)} aria-label={`Delete saved pages for ${job.chapterTitle}`}>Delete</button></div>
            </article>;
          })}</div> : <div className="manga-empty">No saved chapters yet. Open a title and download a chapter to read it offline.</div>}
          <div className="manga-download-footnote">Temporary page cache is separate. Clearing it never deletes saved chapter downloads.</div>
        </section>}
      </main>

      <footer className="footer manga-footer"><div><span className="footer-mark">SF</span><span>SeasonFetch</span></div><span>Manga · local sample data · IndexedDB storage</span></footer>
    </div>
  );
}
