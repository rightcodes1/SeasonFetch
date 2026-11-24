import { sortPages } from './chapterOrdering.js';
import { chapterStorageKey } from './storage.js';

let runSequence = 0;

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError' || /quota|storage.*full/i.test(String(error?.message || ''));
}

function createRunId() {
  return globalThis.crypto?.randomUUID?.() || `manga-run-${Date.now()}-${++runSequence}-${Math.random().toString(36).slice(2)}`;
}

function lockName(chapterKey) {
  return `seasonfetch-manga-download:${chapterKey}`;
}

function cancelledResult(job) {
  return { ...job, status: 'cancelled', error: '' };
}

export function createMangaDownloadManager(provider, storage, { locks = globalThis.navigator?.locks } = {}) {
  const activeJobs = new Map();

  async function downloadOwned(chapter, active, onUpdate, intentPromise) {
    const key = chapterStorageKey(chapter);
    const intent = await intentPromise;
    const token = await storage.beginDownload(key, createRunId(), intent);
    if (!token) {
      return {
        chapterKey: key,
        sourceId: chapter.sourceId,
        workId: chapter.workId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterNumber: chapter.number,
        status: 'cancelled',
        error: ''
      };
    }
    let pages = [];
    let storedIndexes = new Set();
    let job = {
      chapterKey: key,
      sourceId: chapter.sourceId,
      workId: chapter.workId,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterNumber: chapter.number,
      totalPages: 0,
      completedPages: [],
      failedPages: [],
      status: 'downloading',
      error: ''
    };

    try {
      pages = sortPages(await provider.getPages(chapter.id));
      storedIndexes = new Set(await storage.getDownloadedPageIndexes(key));
      const savedJob = await storage.getDownloadJob(key);
      job = { ...job, ...(savedJob || {}) };
      job.chapterKey = key;
      job.sourceId = chapter.sourceId;
      job.workId = chapter.workId;
      job.chapterId = chapter.id;
      job.chapterTitle = chapter.title;
      job.chapterNumber = chapter.number;
      job.completedPages = [...storedIndexes].sort((a, b) => a - b);
      job.totalPages = pages.length;
      job.status = 'downloading';
      job.failedPages = [];
      job.error = '';
      if (!await storage.putDownloadJobIfCurrent(job, token)) return cancelledResult(job);
      onUpdate({ ...job });

      for (const page of pages) {
        if (active.cancelled) break;
        if (storedIndexes.has(page.index)) continue;
        try {
          const blob = await provider.getPageImage(page);
          if (active.cancelled) break;
          if (!(blob instanceof Blob)) throw new Error('The manga source returned an invalid page image.');
          const saved = await storage.putDownloadedPageIfCurrent(key, page, blob, token);
          if (!saved) return cancelledResult(job);
          storedIndexes.add(page.index);
          job.completedPages = [...storedIndexes].sort((a, b) => a - b);
          job.failedPages = job.failedPages.filter(index => index !== page.index);
          job.status = 'downloading';
          job.error = '';
          if (!await storage.putDownloadJobIfCurrent(job, token)) return cancelledResult(job);
          onUpdate({ ...job });
        } catch (error) {
          if (active.cancelled) break;
          job.failedPages = [...new Set([...job.failedPages, page.index])].sort((a, b) => a - b);
          job.error = isQuotaError(error)
            ? 'Browser storage is full. Clear temporary cache or remove a saved chapter, then retry.'
            : (error?.message || 'A page could not be saved. Retry the failed page.');
          job.status = 'partial';
          if (!await storage.putDownloadJobIfCurrent(job, token)) return cancelledResult(job);
          onUpdate({ ...job });
          if (isQuotaError(error)) break;
        }
      }

      const allSaved = pages.length > 0 && storedIndexes.size === pages.length;
      job.completedPages = [...storedIndexes].sort((a, b) => a - b);
      if (active.cancelled) {
        job.status = 'paused';
        job.error = '';
      } else if (!pages.length) {
        job.status = 'failed';
        job.error = 'No pages are available for this chapter.';
      } else if (allSaved) {
        job.failedPages = [];
        job.status = 'complete';
        job.error = '';
      } else if (job.failedPages.length) {
        job.status = job.completedPages.length ? 'partial' : 'failed';
      } else {
        job.status = 'partial';
      }
      if (!await storage.putDownloadJobIfCurrent(job, token)) return cancelledResult(job);
      onUpdate({ ...job });
      return { ...job };
    } catch (error) {
      if (!active.cancelled) {
        job.status = 'failed';
        job.error = error?.message || 'The chapter download could not be completed.';
        try {
          if (await storage.putDownloadJobIfCurrent(job, token)) onUpdate({ ...job });
        } catch {
          // Preserve the original download error; a failed error-record write must not mask it.
        }
      }
      throw error;
    } finally {
      await storage.releaseDownload(token);
    }
  }

  async function download(chapter, { onUpdate = () => {} } = {}) {
    const key = chapterStorageKey(chapter);
    const existing = activeJobs.get(key);
    if (existing) return existing.promise;

    const active = { cancelled: false, promise: null };
    activeJobs.set(key, active);
    const intentPromise = storage.createDownloadIntent(key);
    active.promise = Promise.resolve().then(async () => {
      const run = () => downloadOwned(chapter, active, onUpdate, intentPromise);
      if (typeof locks?.request !== 'function') return run();
      return locks.request(lockName(key), { mode: 'exclusive', ifAvailable: true }, lock => {
        if (lock) return run();
        return storage.getDownloadJob(key).then(job => ({
          ...(job || {
            chapterKey: key,
            sourceId: chapter.sourceId,
            workId: chapter.workId,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            chapterNumber: chapter.number
          }),
          status: 'already-active',
          error: 'This chapter is already downloading in another tab.'
        }));
      });
    });

    try {
      return await active.promise;
    } finally {
      if (activeJobs.get(key) === active) activeJobs.delete(key);
    }
  }

  return {
    download,
    retry: download,
    async cancelAndWait(chapterKey) {
      const active = activeJobs.get(chapterKey);
      if (!active) return;
      active.cancelled = true;
      await active.promise.catch(() => {});
    },
    async resumeInterrupted({ sourceId, onUpdate = () => {} } = {}) {
      const jobs = await storage.listDownloadJobs();
      const resumable = jobs.filter(job =>
        ['queued', 'downloading', 'paused'].includes(job.status)
        && (!sourceId || job.sourceId === sourceId)
      );
      const results = await Promise.all(resumable.map(async job => {
        const chapter = {
          id: job.chapterId,
          sourceId: job.sourceId,
          workId: job.workId,
          title: job.chapterTitle,
          number: job.chapterNumber
        };
        try {
          return await download(chapter, { onUpdate });
        } catch (error) {
          return { ...job, status: 'failed', error: error?.message || 'Unable to resume this download.' };
        }
      }));
      return results.filter(result => result.status !== 'already-active');
    }
  };
}
