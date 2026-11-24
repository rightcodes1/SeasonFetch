import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMockMangaProvider, mockCatalogSourceId } from './mockProvider.js';
import { createMangaDexProvider, mangadexSourceId } from './mangadexProvider.js';
import { sortChapters, sortPages } from './chapterOrdering.js';
import { chapterStorageKey, createMangaStorage } from './storage.js';
import { createMangaProviderRouter, createRequestGuard } from './providerRouter.js';
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
  const initials = (work.title || 'M').split(/\s+/).slice(0, 3).map(word => word[0]).join('').toUpperCase();
  const label = work.sourceId === mockCatalogSourceId ? 'SEASONFETCH · SAMPLE' : String(work.sourceId || 'MANGA').toUpperCase();
  return (
    <div className={`manga-cover${large ? ' manga-cover-large' : ''}`} style={{ '--cover-color': work.coverColor || '#51447e' }} aria-label={`${work.title} cover`}>
      {work.coverUrl && <img className="manga-cover-image" src={work.coverUrl} alt="" loading={large ? 'eager' : 'lazy'} onError={event => event.currentTarget.remove()} />}
      <span className="manga-cover-orbit" />
      <strong>{initials}</strong>
      <small>{label}</small>
    </div>
  );
}

function buildOfflinePages(chapter, pageIndexes) {
  return [...pageIndexes]
    .sort((a, b) => a - b)
    .map(index => ({
      id: `${chapter.id}:page:${index}`,
      sourceId: chapter.sourceId,
      chapterId: chapter.id,
      index,
      label: `Page ${index + 1}`
    }));
}

export default function MangaApp() {
  const [activeSourceId, setActiveSourceId] = useState(mangadexSourceId);
  const storage = useMemo(() => createMangaStorage(), []);
  const router = useMemo(() => createMangaProviderRouter({
    [mangadexSourceId]: createMangaDexProvider(),
    [mockCatalogSourceId]: createMockMangaProvider({ failures: { 'chapter-orbit-10:page:1': 1 } })
  }, storage), [storage]);
  const provider = router.getProvider(activeSourceId);
  const isLiveSource = activeSourceId !== mockCatalogSourceId;
  const searchGuardRef = useRef(null);
  if (!searchGuardRef.current) searchGuardRef.current = createRequestGuard();
  const detailsGuardRef = useRef(null);
  if (!detailsGuardRef.current) detailsGuardRef.current = createRequestGuard();
  const readerGuardRef = useRef(null);
  if (!readerGuardRef.current) readerGuardRef.current = createRequestGuard();
  const [screen, setScreen] = useState('browse');
  const [readerReturnScreen, setReaderReturnScreen] = useState('details');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [selectedWork, setSelectedWork] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [chapterFeedInfo, setChapterFeedInfo] = useState(null);
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
    (async () => {
      try {
        await refreshStorage();
        if (!active) return;
        setStorageReady(true);
        const resumed = await router.resumeInterrupted({ onUpdate: applyJobUpdate });
        if (active && resumed.length) setNotice(`Resumed ${resumed.length} interrupted chapter download${resumed.length === 1 ? '' : 's'}.`);
        if (active) await refreshStorage();
      } catch (error) {
        if (active) setStorageError(error.message || 'Manga storage is unavailable.');
      }
    })();
    return () => { active = false; };
  }, [router, refreshStorage, applyJobUpdate]);

  useEffect(() => {
    const requestId = searchGuardRef.current.next();
    setSearching(true);
    setNotice('');
    provider.search('').then(items => {
      if (searchGuardRef.current.isCurrent(requestId)) setResults(items);
    }).catch(error => {
      if (searchGuardRef.current.isCurrent(requestId)) {
        setResults([]);
        setNotice(error.message || 'Unable to load the manga catalog right now.');
      }
    }).finally(() => {
      if (searchGuardRef.current.isCurrent(requestId)) setSearching(false);
    });
    return () => { searchGuardRef.current.invalidate(); };
  }, [provider]);

  function switchSource(nextSourceId) {
    if (nextSourceId === activeSourceId) return;
    searchGuardRef.current.invalidate();
    detailsGuardRef.current.invalidate();
    readerGuardRef.current.invalidate();
    setActiveSourceId(nextSourceId);
    setScreen('browse');
    setQuery('');
    setResults([]);
    setSelectedWork(null);
    setChapters([]);
    setChapterFeedInfo(null);
    setSelectedChapter(null);
    setPages([]);
    setNotice('');
  }

  async function searchCatalog(event) {
    event?.preventDefault();
    const requestId = searchGuardRef.current.next();
    setSearching(true);
    setNotice('');
    try {
      const items = await provider.search(query);
      if (!searchGuardRef.current.isCurrent(requestId)) return;
      setResults(items);
    } catch (error) {
      if (!searchGuardRef.current.isCurrent(requestId)) return;
      setNotice(error.message || 'The manga catalog could not be searched.');
    } finally {
      if (searchGuardRef.current.isCurrent(requestId)) setSearching(false);
    }
  }

  async function openWork(work) {
    const requestId = detailsGuardRef.current.next();
    setScreen('details');
    setSelectedChapter(null);
    setChapters([]);
    setChapterFeedInfo(null);
    setSelectedWork(work);
    setLoadingDetails(true);
    setNotice('');
    try {
      const workProvider = router.getProvider(work.sourceId || activeSourceId);
      const [details, workChapters] = await Promise.all([workProvider.getDetails(work.id), workProvider.getChapters(work.id)]);
      if (!detailsGuardRef.current.isCurrent(requestId)) return;
      setSelectedWork(details);
      setChapters(sortChapters(workChapters));
      setChapterFeedInfo(workProvider.getChapterFeedInfo?.(work.id) || null);
    } catch (error) {
      if (!detailsGuardRef.current.isCurrent(requestId)) return;
      setNotice(error.message || 'Unable to load manga details.');
    } finally {
      if (detailsGuardRef.current.isCurrent(requestId)) setLoadingDetails(false);
    }
  }

  async function openReader(chapter, { preferOffline = false, returnTo = 'details' } = {}) {
    const requestId = readerGuardRef.current.next();
    setNotice('');
    setReaderReturnScreen(returnTo);
    setSelectedChapter(chapter);
    setScreen('reader');
    setPages([]);
    setPageIndex(0);
    setBookmark(null);
    setProgress(null);
    setImageUrl('');
    setPageError('');
    try {
      const key = chapterStorageKey(chapter);
      let nextPages = [];
      const shouldTryOfflineFirst = preferOffline || !online;
      if (shouldTryOfflineFirst) {
        const downloadedIndexes = await storage.getDownloadedPageIndexes(key);
        if (downloadedIndexes.length) {
          nextPages = buildOfflinePages(chapter, downloadedIndexes);
        }
      }
      if (!nextPages.length) {
        if (!online) throw new Error('This chapter is not saved for offline reading. Download it while online.');
        const chapterProvider = router.getProvider(chapter.sourceId);
        try {
          nextPages = sortPages(await chapterProvider.getPages(chapter.id));
        } catch (fetchError) {
          const downloadedIndexes = await storage.getDownloadedPageIndexes(key);
          if (!downloadedIndexes.length) throw fetchError;
          nextPages = buildOfflinePages(chapter, downloadedIndexes);
        }
      }
      if (!readerGuardRef.current.isCurrent(requestId)) return;
      if (!nextPages.length) throw new Error('No pages are available for this chapter.');
      const [savedProgress, savedBookmark] = await Promise.all([storage.getReadingProgress(key), storage.getBookmark(key)]);
      if (!readerGuardRef.current.isCurrent(requestId)) return;
      const restored = restoreReadingPosition(savedProgress, nextPages.length);
      const restoredProgress = { workId: chapter.workId, chapterId: chapter.id, ...restored };
      setPages(nextPages);
      setPageIndex(restored.pageIndex);
      setProgress(restoredProgress);
      setBookmark(savedBookmark);
      await storage.putReadingProgress(key, restoredProgress);
    } catch (error) {
      if (readerGuardRef.current.isCurrent(requestId)) {
        setPageError(error.message || 'Unable to open this chapter.');
      }
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
        blob = await router.getProvider(selectedChapter.sourceId).getPageImage(currentPage);
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
  }, [screen, selectedChapter, pages, pageIndex, pageAttempt, router, storage, online]);

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
      const result = await router.download(chapter, { onUpdate: applyJobUpdate });
      await refreshStorage();
      setNotice(result.status === 'complete' ? `${chapter.title} is saved for offline reading.` : result.error || 'Some pages need a retry.');
    } catch (error) {
      setNotice(error.message || 'The chapter download could not start.');
    }
  }

  async function retryDownload(job) {
    const matchingChapter = chapters.find(item => item.id === job.chapterId && item.sourceId === job.sourceId);
    const chapter = matchingChapter || {
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
      await router.cancelAndWait(job.chapterKey, job.sourceId);
      await storage.deleteDownloadedChapter(job.chapterKey);
      await refreshStorage();
    } catch (error) {
      setStorageError(error.message || 'Saved chapter could not be deleted.');
    }
  }

  async function openSavedChapter(job) {
    const savedChapter = {
      id: job.chapterId,
      sourceId: job.sourceId,
      workId: job.workId,
      title: job.chapterTitle,
      number: job.chapterNumber,
      language: 'en',
      pageCount: job.totalPages || 0,
      readingSource: { id: job.sourceId, name: job.sourceId === mockCatalogSourceId ? 'Local sample source' : 'Offline copy', language: 'en', workId: job.workId, chapterIds: [job.chapterId] }
    };
    const downloadedIndexes = await storage.getDownloadedPageIndexes(job.chapterKey);
    if (downloadedIndexes.length && (job.status === 'complete' || !online)) {
      setSelectedWork(current => current?.id === job.workId ? current : {
        id: job.workId,
        sourceId: job.sourceId,
        title: job.chapterTitle || 'Offline chapter',
        alternateTitles: [],
        description: '',
        genres: []
      });
      await openReader(savedChapter, { preferOffline: true, returnTo: 'downloads' });
      return;
    }

    try {
      const jobProvider = router.getProvider(job.sourceId);
      const [work, workChapters] = await Promise.all([jobProvider.getDetails(job.workId), jobProvider.getChapters(job.workId)]);
      const orderedChapters = sortChapters(workChapters);
      const chapter = orderedChapters.find(item => item.id === job.chapterId) || savedChapter;
      setSelectedWork(work);
      setChapters(orderedChapters);
      setChapterFeedInfo(jobProvider.getChapterFeedInfo?.(job.workId) || null);
      await openReader(chapter, { preferOffline: true, returnTo: 'details' });
    } catch {
      setSelectedWork(current => current?.id === job.workId ? current : {
        id: job.workId,
        sourceId: job.sourceId,
        title: job.chapterTitle || 'Offline chapter',
        alternateTitles: [],
        description: '',
        genres: []
      });
      await openReader(savedChapter, { preferOffline: true, returnTo: 'downloads' });
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
            <p className="manga-subtitle">{isLiveSource ? 'Search and read free English chapters via the MangaDex API with private offline caching.' : 'A local sample catalog for exploring chapters, progress and offline reading.'}</p>
          </div>
          <div className="manga-heading-controls">
            <div className={`manga-demo-badge${isLiveSource ? ' is-live' : ''}`}><i /> {isLiveSource ? 'MANGADEX · LIVE API' : 'SAMPLE CATALOG · LOCAL'}</div>
            <div className="manga-source-switch" role="group" aria-label="Manga source">
              <button type="button" className={activeSourceId === mangadexSourceId ? 'is-active' : ''} onClick={() => switchSource(mangadexSourceId)}>MangaDex</button>
              <button type="button" className={activeSourceId === mockCatalogSourceId ? 'is-active' : ''} onClick={() => switchSource(mockCatalogSourceId)}>Sample</button>
            </div>
          </div>
        </div>

        {!storageReady && <div className="manga-storage-alert">Opening this browser's private Manga library…</div>}
        {storageError && <div className="manga-storage-alert is-error" role="alert">{storageError}</div>}
        {notice && <div className="manga-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}

        {screen === 'browse' && <section className="manga-discovery">
          <form className="manga-search" onSubmit={searchCatalog}>
            <label htmlFor="manga-query">Find a story</label>
            <div className="manga-search-controls">
              <input id="manga-query" value={query} onChange={event => setQuery(event.target.value)} placeholder={isLiveSource ? 'Search MangaDex titles (e.g. Berserk, Frieren, Chainsaw Man)...' : 'Search the sample catalog'} />
              <button className="primary-button" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
            </div>
            <span>{isLiveSource ? 'Powered by MangaDex public API via SeasonFetch proxy (data-saver pages, credited scanlation groups).' : 'Search runs locally against sample data; no external source is contacted.'}</span>
          </form>
          <div className="manga-section-heading"><div><span className="section-kicker">{isLiveSource ? 'MANGADEX CATALOG' : 'LOCAL SAMPLE LIBRARY'}</span><h2>{query.trim() ? 'Search results' : isLiveSource ? 'Popular on MangaDex' : 'Stories to explore'}</h2></div><span>{searching ? 'Loading…' : `${results.length} titles`}</span></div>
          {results.length ? <div className="manga-work-grid">
            {results.map(work => <button className="manga-work-card" key={work.id} onClick={() => openWork(work)}>
              <Cover work={work} />
              <span className="manga-work-copy"><strong>{work.title}</strong><small>{work.year || 'Year unknown'} <i /> {work.status || 'unknown'}{work.genres?.length ? <> <i /> {work.genres.slice(0, 2).join(' · ')}</> : null}</small><span>{work.description || 'No synopsis available.'}</span><em>Open details <b>→</b></em></span>
            </button>)}
          </div> : <div className="manga-empty">{searching ? 'Loading titles from MangaDex…' : 'No titles matched that search. Try another manga title.'}</div>}
        </section>}

        {screen === 'details' && selectedWork && <section className="manga-details">
          <button className="manga-back-link" onClick={() => setScreen('browse')}>← Back to catalog</button>
          <div className="manga-work-banner">
            <Cover work={selectedWork} large />
            <div className="manga-work-detail-copy"><span className="section-kicker">{selectedWork.status?.toUpperCase() || 'STATUS UNKNOWN'} · {selectedWork.year || 'YEAR UNKNOWN'}</span><h2>{selectedWork.title}</h2><p>{selectedWork.description || 'No synopsis available.'}</p><div className="manga-tags">{(selectedWork.genres || []).map(genre => <span key={genre}>{genre}</span>)}</div><small>{selectedWork.author ? `Story: ${selectedWork.author}` : ''}{selectedWork.author && selectedWork.artist ? ' · ' : ''}{selectedWork.artist ? `Art: ${selectedWork.artist}` : ''}{selectedWork.externalUrl ? <> · <a className="manga-external-inline" href={selectedWork.externalUrl} target="_blank" rel="noreferrer">View on MangaDex ↗</a></> : null}</small></div>
          </div>
          <div className="manga-section-heading manga-chapter-heading"><div><span className="section-kicker">CHAPTERS</span><h2>Choose a chapter</h2></div><span>{loadingDetails ? 'Loading chapters…' : chapterFeedInfo?.truncated ? `Showing ${chapterFeedInfo.loaded} of ${chapterFeedInfo.total} chapter uploads (truncated)` : `${chapters.length} chapters · sorted numerically`}</span></div>
          {chapterFeedInfo?.truncated && <div className="manga-storage-alert" role="status">Showing the first {chapterFeedInfo.loaded} of {chapterFeedInfo.total} English chapter uploads for this title (multiple scanlation groups may be included).</div>}
          <div className="manga-chapter-list">
            {chapters.map(chapter => {
              const job = jobs.find(item => item.chapterKey === chapterStorageKey(chapter));
              const percent = jobPercent(job);
              const isExternalOnly = chapter.readableInline === false;
              return <article className="manga-chapter-row" key={chapter.id}>
                <div className="manga-chapter-copy"><strong>{chapterNumberLabel(chapter)} <span>{chapter.title}</span></strong><small>{chapter.volumeNumber ? `Volume ${chapter.volumeNumber} · ` : ''}{isExternalOnly ? 'External official release' : `${chapter.pageCount} pages`} · {chapter.language.toUpperCase()} · {chapter.readingSource.name}</small>{job && <div className="manga-mini-progress"><span><i style={{ width: `${percent}%` }} /></span><small>{job.status === 'complete' ? 'Saved offline' : `${job.completedPages?.length || 0}/${job.totalPages} pages · ${job.status}`}</small></div>}</div>
                <div className="manga-chapter-actions">
                  {isExternalOnly && chapter.externalUrl ? (
                    <a className="secondary-button small-button manga-external-link" href={chapter.externalUrl} target="_blank" rel="noreferrer">Read officially ↗</a>
                  ) : isExternalOnly ? (
                    <span className="manga-unavailable-pill">No pages</span>
                  ) : (
                    <>
                      <button className="secondary-button small-button" onClick={() => openReader(chapter, { preferOffline: job?.status === 'complete', returnTo: 'details' })}>Read</button>
                      {job?.status === 'complete' ? <button className="manga-saved-pill" onClick={() => setScreen('downloads')}>Saved</button> : <button className="primary-button small-button" disabled={!storageReady} onClick={() => startDownload(chapter)}>{job?.status === 'partial' || job?.status === 'failed' ? 'Retry download' : job?.status === 'downloading' ? 'Downloading…' : 'Download'}</button>}
                    </>
                  )}
                </div>
              </article>;
            })}
          </div>
          {!loadingDetails && !chapters.length && <div className="manga-empty">No English chapters are currently listed for this title on {isLiveSource ? 'MangaDex' : 'the sample catalog'}.</div>}
        </section>}

        {screen === 'reader' && selectedChapter && <section className="manga-reader">
          <div className="manga-reader-toolbar"><button className="manga-back-link" onClick={() => setScreen(readerReturnScreen)}>{readerReturnScreen === 'downloads' ? '← Offline library' : '← Chapters'}</button><div><span className="section-kicker">{selectedWork?.title || 'Manga'} · {chapterNumberLabel(selectedChapter)}</span><h2>{selectedChapter.title}</h2></div><button className={`manga-bookmark${bookmark?.pageIndex === pageIndex ? ' is-bookmarked' : ''}`} onClick={toggleBookmark} aria-pressed={bookmark?.pageIndex === pageIndex}>{bookmark?.pageIndex === pageIndex ? '★ Bookmarked' : '☆ Bookmark page'}</button></div>
          <div className="manga-reader-stage" aria-live="polite">
            {pageLoading && <div className="manga-reader-message">Loading page…</div>}
            {pageError && <div className="manga-reader-message is-error"><strong>Page unavailable</strong><span>{pageError}</span><button className="secondary-button small-button" onClick={() => { setOnline(globalThis.navigator?.onLine !== false); if (getReaderRetryTarget(pages.length) === 'chapter') void openReader(selectedChapter, { preferOffline: selectedJob?.status === 'complete', returnTo: readerReturnScreen }); else setPageAttempt(value => value + 1); }}>{getReaderRetryTarget(pages.length) === 'chapter' ? 'Retry chapter' : 'Retry page'}</button></div>}
            {imageUrl && <img src={imageUrl} alt={`${selectedChapter.title}, page ${pageIndex + 1}`} className="manga-page-image" />}
          </div>
          <div className="manga-reader-controls"><button className="secondary-button" disabled={pageIndex <= 0 || !pages.length} onClick={() => void goToPage(pageIndex - 1)}>← Previous</button><div><strong>Page {pages.length ? pageIndex + 1 : 0} <span>/ {pages.length}</span></strong><small>{imageOffline ? 'OFFLINE COPY' : selectedChapter.sourceId !== mockCatalogSourceId ? 'MANGADEX · DATA SAVER' : online ? 'SAMPLE SOURCE' : 'TEMPORARY CACHE'}</small></div><button className="primary-button" disabled={pageIndex >= pages.length - 1 || !pages.length} onClick={() => void goToPage(pageIndex + 1)}>Next →</button></div>
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

      <footer className="footer manga-footer"><div><span className="footer-mark">SF</span><span>SeasonFetch</span></div><span>Manga · {isLiveSource ? 'MangaDex API & scanlation groups' : 'local sample data'} · IndexedDB storage</span></footer>
    </div>
  );
}
