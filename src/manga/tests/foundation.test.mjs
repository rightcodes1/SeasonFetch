import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockMangaProvider } from '../mockProvider.js';
import { sortChapters, sortPages } from '../chapterOrdering.js';
import { createMangaDownloadManager } from '../downloadManager.js';
import { chapterStorageKey, createMangaStorage } from '../storage.js';
import { getReaderRetryTarget, restoreReadingPosition } from '../readerProgress.js';

class MemoryStorage {
  cache = new Map();
  downloads = new Map();
  jobs = new Map();
  progress = new Map();
  bookmarks = new Map();
  downloadStates = new Map();
  failNextDownloadWrite = false;

  async putCachedPage(chapterKey, page, blob) { this.cache.set(`${chapterKey}::${page.index}`, { chapterKey, pageIndex: page.index, blob }); }
  async getCachedPage(chapterKey, index) { return this.cache.get(`${chapterKey}::${index}`)?.blob || null; }
  async putDownloadedPage(chapterKey, page, blob) {
    if (this.failNextDownloadWrite) {
      this.failNextDownloadWrite = false;
      const error = new Error('Quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.downloads.set(`${chapterKey}::${page.index}`, { chapterKey, pageIndex: page.index, blob });
  }
  async createDownloadIntent(chapterKey) {
    const state = this.downloadStates.get(chapterKey) || { key: chapterKey, generation: 0, runId: null, intentCounter: 0 };
    const intent = { chapterKey, generation: state.generation, intentId: state.intentCounter + 1 };
    this.downloadStates.set(chapterKey, { ...state, intentCounter: intent.intentId });
    return intent;
  }
  async beginDownload(chapterKey, runId, intent) {
    const state = this.downloadStates.get(chapterKey) || { key: chapterKey, generation: 0, runId: null, intentCounter: 0 };
    if (state.generation !== intent.generation) return null;
    const generation = state.generation + 1;
    const token = { chapterKey, generation, runId };
    this.downloadStates.set(chapterKey, { ...state, generation, runId });
    return token;
  }
  isCurrentDownload(token) {
    const state = this.downloadStates.get(token.chapterKey);
    return state?.generation === token.generation && state?.runId === token.runId;
  }
  async putDownloadedPageIfCurrent(chapterKey, page, blob, token) {
    if (!this.isCurrentDownload(token)) return false;
    await this.putDownloadedPage(chapterKey, page, blob);
    return this.isCurrentDownload(token);
  }
  async getDownloadedPage(chapterKey, index) { return this.downloads.get(`${chapterKey}::${index}`)?.blob || null; }
  async getDownloadedPageIndexes(chapterKey) { return [...this.downloads.values()].filter(page => page.chapterKey === chapterKey).map(page => page.pageIndex); }
  async deleteDownloadedChapter(chapterKey) {
    const generation = (this.downloadStates.get(chapterKey)?.generation || 0) + 1;
    const state = this.downloadStates.get(chapterKey);
    this.downloadStates.set(chapterKey, { key: chapterKey, generation, runId: null, intentCounter: state?.intentCounter || 0 });
    for (const [key, page] of this.downloads) if (page.chapterKey === chapterKey) this.downloads.delete(key);
    this.jobs.delete(chapterKey);
  }
  async clearTemporaryCache() { this.cache.clear(); }
  async getDownloadJob(key) { return this.jobs.get(key) || null; }
  async putDownloadJob(job) { this.jobs.set(job.chapterKey, structuredClone(job)); }
  async putDownloadJobIfCurrent(job, token) {
    if (!this.isCurrentDownload(token)) return false;
    await this.putDownloadJob(job);
    return this.isCurrentDownload(token);
  }
  async releaseDownload(token) {
    if (!this.isCurrentDownload(token)) return false;
    this.downloadStates.set(token.chapterKey, { key: token.chapterKey, generation: token.generation, runId: null });
    return true;
  }
  async listDownloadJobs() { return [...this.jobs.values()]; }
  async putReadingProgress(key, record) { this.progress.set(key, structuredClone(record)); }
  async getReadingProgress(key) { return this.progress.get(key) || null; }
  async putBookmark(key, pageIndex) { this.bookmarks.set(key, { pageIndex }); }
  async getBookmark(key) { return this.bookmarks.get(key) || null; }
}

const getWork = async provider => provider.getDetails('work-quiet-orbit');
const getChapter = async provider => (await provider.getChapters('work-quiet-orbit')).find(chapter => chapter.id === 'chapter-orbit-1');

test('a failed IndexedDB open is not cached and a later operation retries it', async () => {
  let openAttempts = 0;
  const indexedDB = {
    open() {
      openAttempts += 1;
      const request = { error: new Error('temporary database open failure') };
      queueMicrotask(() => request.onerror());
      return request;
    }
  };
  const storage = createMangaStorage({ indexedDB, storageManager: null });

  await assert.rejects(storage.getCachedPage('chapter-key', 0), /temporary database open failure/);
  await assert.rejects(storage.getCachedPage('chapter-key', 0), /temporary database open failure/);
  assert.equal(openAttempts, 2);
});

test('a late IndexedDB success after a blocked-open error closes its connection', async () => {
  let closeCalls = 0;
  const database = { close() { closeCalls += 1; } };
  const indexedDB = {
    open() {
      const request = { result: database };
      queueMicrotask(() => {
        request.onblocked();
        request.onsuccess();
      });
      return request;
    }
  };
  const storage = createMangaStorage({ indexedDB, storageManager: null });

  await assert.rejects(storage.getCachedPage('chapter-key', 0), /blocked by another open tab/);
  assert.equal(closeCalls, 1);
});

test('a version change closes the cached connection and the next operation reopens the database', async () => {
  let openAttempts = 0;
  let closeCalls = 0;
  const databases = [];
  const indexedDB = {
    open() {
      openAttempts += 1;
      const database = {
        objectStoreNames: { contains: () => true },
        close() { closeCalls += 1; },
        transaction() {
          let transaction;
          const store = {
            get() {
              const request = {};
              queueMicrotask(() => {
                request.result = undefined;
                request.onsuccess?.();
                transaction.oncomplete?.();
              });
              return request;
            }
          };
          transaction = { objectStore: () => store };
          return transaction;
        }
      };
      databases.push(database);
      const request = { result: database };
      queueMicrotask(() => request.onsuccess());
      return request;
    }
  };
  const storage = createMangaStorage({ indexedDB, storageManager: null });

  await storage.getCachedPage('chapter-key', 0);
  databases[0].onversionchange();
  await storage.getCachedPage('chapter-key', 0);
  assert.equal(openAttempts, 2);
  assert.equal(closeCalls, 1);
});

test('restoring a completed chapter preserves completion only at its last page', () => {
  assert.deepEqual(restoreReadingPosition({ pageIndex: 3, completed: true }, 4), { pageIndex: 3, completed: true });
  assert.deepEqual(restoreReadingPosition({ pageIndex: 1, completed: true }, 4), { pageIndex: 1, completed: false });
  assert.deepEqual(restoreReadingPosition({ pageIndex: -4, completed: false }, 4), { pageIndex: 0, completed: false });
});

test('reader retries chapter-page discovery when no page list was loaded', () => {
  assert.equal(getReaderRetryTarget(0), 'chapter');
  assert.equal(getReaderRetryTarget(1), 'page');
});

test('mock search and details are provider-neutral and local', async () => {
  const provider = createMockMangaProvider();
  assert.deepEqual((await provider.search('quiet')).map(work => work.id), ['work-quiet-orbit']);
  const work = await getWork(provider);
  assert.equal(work.title, 'The Quiet Orbit');
  assert.equal(work.volumes.length, 2);
});

test('chapter ordering is numeric and page order follows page index', async () => {
  const provider = createMockMangaProvider();
  const chapters = await provider.getChapters('work-quiet-orbit');
  assert.deepEqual(sortChapters(chapters).map(chapter => chapter.number), [1, 2, 3, 10]);
  const pages = sortPages(await provider.getPages('chapter-orbit-1'));
  assert.deepEqual(pages.map(page => page.index), [0, 1, 2, 3]);
  const image = await provider.getPageImage(pages[0]);
  assert.ok(image instanceof Blob);
  assert.equal(image.type, 'image/svg+xml');
});

test('page downloads persist one blob per page and emit progress to completion', async () => {
  const provider = createMockMangaProvider();
  const storage = new MemoryStorage();
  const chapter = await getChapter(provider);
  const progress = [];
  const job = await createMangaDownloadManager(provider, storage).download(chapter, { onUpdate: value => progress.push(value.completedPages.length) });
  const key = chapterStorageKey(chapter);
  assert.equal(job.status, 'complete');
  assert.equal(storage.downloads.size, 4);
  assert.ok(progress.includes(1));
  assert.deepEqual(await storage.getDownloadedPageIndexes(key), [0, 1, 2, 3]);
});

test('a chapter with no available pages is failed rather than marked as downloaded', async () => {
  const provider = createMockMangaProvider();
  provider.getPages = async () => [];
  const storage = new MemoryStorage();
  const chapter = await getChapter(provider);
  const job = await createMangaDownloadManager(provider, storage).download(chapter);

  assert.equal(job.status, 'failed');
  assert.equal(job.totalPages, 0);
  assert.match(job.error, /no pages are available/i);
  assert.equal(storage.downloads.size, 0);
});

test('a failed page is retained as partial and retry only fetches the missing page', async () => {
  const chapterId = 'chapter-orbit-1';
  const pageId = `${chapterId}:page:2`;
  const provider = createMockMangaProvider({ failures: { [pageId]: 1 } });
  const storage = new MemoryStorage();
  const manager = createMangaDownloadManager(provider, storage);
  const chapter = await getChapter(provider);
  const first = await manager.download(chapter);
  assert.equal(first.status, 'partial');
  assert.deepEqual(first.failedPages, [2]);
  assert.equal(storage.downloads.size, 3);
  const retried = await manager.retry(chapter);
  assert.equal(retried.status, 'complete');
  assert.equal(storage.downloads.size, 4);
});

test('interrupted jobs resume after reload by skipping pages already saved', async () => {
  const provider = createMockMangaProvider();
  const storage = new MemoryStorage();
  const chapter = await getChapter(provider);
  const key = chapterStorageKey(chapter);
  const pages = sortPages(await provider.getPages(chapter.id));
  await storage.putDownloadedPage(key, pages[0], await provider.getPageImage(pages[0]));
  await storage.putDownloadJob({ chapterKey: key, sourceId: chapter.sourceId, workId: chapter.workId, chapterId: chapter.id, chapterTitle: chapter.title, chapterNumber: chapter.number, totalPages: pages.length, completedPages: [0], failedPages: [], status: 'downloading' });
  const result = await createMangaDownloadManager(provider, storage).resumeInterrupted();
  assert.equal(result[0].status, 'complete');
  assert.equal(storage.downloads.size, 4);
  assert.deepEqual(result[0].completedPages, [0, 1, 2, 3]);
});

test('temporary-cache cleanup never deletes permanent chapter pages', async () => {
  const provider = createMockMangaProvider();
  const storage = new MemoryStorage();
  const chapter = await getChapter(provider);
  const page = sortPages(await provider.getPages(chapter.id))[0];
  const image = await provider.getPageImage(page);
  const key = chapterStorageKey(chapter);
  await storage.putCachedPage(key, page, image);
  await storage.putDownloadedPage(key, page, image);
  await storage.clearTemporaryCache();
  assert.equal(await storage.getCachedPage(key, page.index), null);
  assert.ok(await storage.getDownloadedPage(key, page.index));
});

test('reading progress and bookmark records persist independently by chapter', async () => {
  const provider = createMockMangaProvider();
  const storage = new MemoryStorage();
  const chapter = await getChapter(provider);
  const key = chapterStorageKey(chapter);
  await storage.putReadingProgress(key, { pageIndex: 2, completed: false });
  await storage.putBookmark(key, 2);
  assert.equal((await storage.getReadingProgress(key)).pageIndex, 2);
  assert.equal((await storage.getBookmark(key)).pageIndex, 2);
});

test('quota failures preserve resumable partial state and provide a retryable job', async () => {
  const provider = createMockMangaProvider();
  const storage = new MemoryStorage();
  storage.failNextDownloadWrite = true;
  const chapter = await getChapter(provider);
  const job = await createMangaDownloadManager(provider, storage).download(chapter);
  assert.equal(job.status, 'failed');
  assert.deepEqual(job.failedPages, [0]);
  assert.match(job.error, /storage is full/i);
  const recovered = await createMangaDownloadManager(provider, storage).retry(chapter);
  assert.equal(recovered.status, 'complete');
});

test('deleting during an active download waits for the page request and prevents resurrection', async () => {
  const provider = createMockMangaProvider();
  const chapter = await getChapter(provider);
  const originalGetPageImage = provider.getPageImage;
  let signalPageStarted;
  let releasePage;
  const pageStarted = new Promise(resolve => { signalPageStarted = resolve; });
  const pageGate = new Promise(resolve => { releasePage = resolve; });
  provider.getPageImage = async page => {
    signalPageStarted();
    await pageGate;
    return originalGetPageImage(page);
  };

  const storage = new MemoryStorage();
  const manager = createMangaDownloadManager(provider, storage);
  const key = chapterStorageKey(chapter);
  const download = manager.download(chapter);
  await pageStarted;

  const deletion = (async () => {
    await manager.cancelAndWait(key);
    await storage.deleteDownloadedChapter(key);
  })();
  releasePage();
  await deletion;
  const result = await download;

  assert.equal(result.status, 'paused');
  assert.equal(storage.downloads.size, 0);
  assert.equal(storage.jobs.has(key), false);
});

test('deleting a saved chapter leaves other chapter downloads untouched', async () => {
  const provider = createMockMangaProvider();
  const storage = new MemoryStorage();
  const chapters = await provider.getChapters('work-quiet-orbit');
  const manager = createMangaDownloadManager(provider, storage);
  await manager.download(chapters.find(chapter => chapter.id === 'chapter-orbit-1'));
  await manager.download(chapters.find(chapter => chapter.id === 'chapter-orbit-2'));
  await storage.deleteDownloadedChapter(chapterStorageKey(chapters.find(chapter => chapter.id === 'chapter-orbit-1')));
  assert.equal(storage.downloads.size, 3);
  assert.equal(storage.jobs.size, 1);
});


class FakeLockManager {
  held = new Set();

  request(name, options, callback) {
    if (options.ifAvailable && this.held.has(name)) return Promise.resolve().then(() => callback(null));
    this.held.add(name);
    return Promise.resolve().then(() => callback({ name })).finally(() => this.held.delete(name));
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('a second manager deleting during a download fences off all later writes', async () => {
  const provider = createMockMangaProvider();
  const chapter = await getChapter(provider);
  const originalGetPageImage = provider.getPageImage.bind(provider);
  const started = deferred();
  const release = deferred();
  provider.getPageImage = async page => {
    if (page.index === 0) {
      started.resolve();
      await release.promise;
    }
    return originalGetPageImage(page);
  };

  const storage = new MemoryStorage();
  const managerA = createMangaDownloadManager(provider, storage);
  const managerB = createMangaDownloadManager(provider, storage);
  const key = chapterStorageKey(chapter);
  const active = managerA.download(chapter);
  await started.promise;

  await managerB.cancelAndWait(key);
  await storage.deleteDownloadedChapter(key);
  release.resolve();
  const result = await active;

  assert.equal(result.status, 'cancelled');
  assert.equal(storage.downloads.size, 0);
  assert.equal(storage.jobs.has(key), false);
});

test('deletion during an in-flight page request removes earlier pages and rejects the late page', async () => {
  const provider = createMockMangaProvider();
  const chapter = await getChapter(provider);
  const originalGetPageImage = provider.getPageImage.bind(provider);
  const secondPageStarted = deferred();
  const releaseSecondPage = deferred();
  provider.getPageImage = async page => {
    if (page.index === 1) {
      secondPageStarted.resolve();
      await releaseSecondPage.promise;
    }
    return originalGetPageImage(page);
  };

  const storage = new MemoryStorage();
  const managerA = createMangaDownloadManager(provider, storage);
  const managerB = createMangaDownloadManager(provider, storage);
  const key = chapterStorageKey(chapter);
  const active = managerA.download(chapter);
  await secondPageStarted.promise;
  assert.deepEqual(await storage.getDownloadedPageIndexes(key), [0]);

  await storage.deleteDownloadedChapter(key);
  releaseSecondPage.resolve();
  const result = await active;

  assert.equal(result.status, 'cancelled');
  assert.deepEqual(await storage.getDownloadedPageIndexes(key), []);
  assert.equal(await storage.getDownloadJob(key), null);
  assert.equal(await managerB.resumeInterrupted().then(items => items.length), 0);
});

test('a fresh download after deletion gets a new generation and completes normally', async () => {
  const provider = createMockMangaProvider();
  const chapter = await getChapter(provider);
  const originalGetPageImage = provider.getPageImage.bind(provider);
  const started = deferred();
  const release = deferred();
  provider.getPageImage = async page => {
    if (page.index === 0 && !startedResolved) {
      startedResolved = true;
      started.resolve();
      await release.promise;
    }
    return originalGetPageImage(page);
  };
  let startedResolved = false;

  const storage = new MemoryStorage();
  const managerA = createMangaDownloadManager(provider, storage);
  const managerB = createMangaDownloadManager(provider, storage);
  const key = chapterStorageKey(chapter);
  const stale = managerA.download(chapter);
  await started.promise;
  await storage.deleteDownloadedChapter(key);
  release.resolve();
  assert.equal((await stale).status, 'cancelled');

  const fresh = await managerB.download(chapter);
  assert.equal(fresh.status, 'complete');
  assert.equal(storage.downloads.size, 4);
  assert.equal((await storage.getDownloadJob(key)).status, 'complete');
});

test('two managers coordinate one same-chapter download across manager instances', async () => {
  const provider = createMockMangaProvider();
  const chapter = await getChapter(provider);
  const originalGetPageImage = provider.getPageImage.bind(provider);
  const started = deferred();
  const release = deferred();
  let pageListRequests = 0;
  let imageRequests = 0;
  provider.getPages = async (...args) => {
    pageListRequests += 1;
    return createMockMangaProvider().getPages(...args);
  };
  provider.getPageImage = async page => {
    imageRequests += 1;
    if (page.index === 0) {
      started.resolve();
      await release.promise;
    }
    return originalGetPageImage(page);
  };

  const storage = new MemoryStorage();
  const locks = new FakeLockManager();
  const managerA = createMangaDownloadManager(provider, storage, { locks });
  const managerB = createMangaDownloadManager(provider, storage, { locks });
  const first = managerA.download(chapter);
  await started.promise;
  const second = await managerB.download(chapter);

  assert.equal(second.status, 'already-active');
  assert.match(second.error, /already downloading in another tab/i);
  assert.equal(pageListRequests, 1);
  release.resolve();
  assert.equal((await first).status, 'complete');
  assert.equal(pageListRequests, 1);
  assert.equal(imageRequests, 4);
});

test('a paused download resumes through a fresh manager after reload', async () => {
  const provider = createMockMangaProvider();
  const chapter = await getChapter(provider);
  const originalGetPageImage = provider.getPageImage.bind(provider);
  const secondPageStarted = deferred();
  const releaseSecondPage = deferred();
  provider.getPageImage = async page => {
    if (page.index === 1 && !secondPageReleased) {
      secondPageStarted.resolve();
      await releaseSecondPage.promise;
    }
    return originalGetPageImage(page);
  };
  let secondPageReleased = false;

  const storage = new MemoryStorage();
  const locks = new FakeLockManager();
  const managerBeforeReload = createMangaDownloadManager(provider, storage, { locks });
  const key = chapterStorageKey(chapter);
  const active = managerBeforeReload.download(chapter);
  await secondPageStarted.promise;

  const cancelling = managerBeforeReload.cancelAndWait(key);
  secondPageReleased = true;
  releaseSecondPage.resolve();
  await cancelling;
  assert.equal((await active).status, 'paused');
  assert.deepEqual(await storage.getDownloadedPageIndexes(key), [0]);

  const managerAfterReload = createMangaDownloadManager(provider, storage, { locks });
  const resumed = await managerAfterReload.resumeInterrupted();
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].status, 'complete');
  assert.deepEqual(await storage.getDownloadedPageIndexes(key), [0, 1, 2, 3]);
});


class DeferredLockManager {
  constructor() {
    this.entered = deferred();
    this.gate = deferred();
  }

  request(_name, _options, callback) {
    this.entered.resolve();
    return this.gate.promise.then(() => callback({ name: 'deferred-test-lock' }));
  }
}

test('deletion invalidates a previously recorded intent that has not claimed the download lock yet', async () => {
  const provider = createMockMangaProvider();
  const chapter = await getChapter(provider);
  let pageListRequests = 0;
  provider.getPages = async (...args) => {
    pageListRequests += 1;
    return createMockMangaProvider().getPages(...args);
  };

  const storage = new MemoryStorage();
  const locks = new DeferredLockManager();
  const managerA = createMangaDownloadManager(provider, storage, { locks });
  const managerB = createMangaDownloadManager(provider, storage);
  const key = chapterStorageKey(chapter);
  const pending = managerA.download(chapter);
  await locks.entered.promise;
  await storage.deleteDownloadedChapter(key);
  locks.gate.resolve();
  const result = await pending;

  assert.equal(result.status, 'cancelled');
  assert.equal(pageListRequests, 0);
  assert.equal(storage.downloads.size, 0);
  assert.equal(await storage.getDownloadJob(key), null);
  assert.equal(await managerB.resumeInterrupted().then(items => items.length), 0);
});
