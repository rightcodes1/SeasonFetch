const DATABASE_NAME = 'seasonfetch-manga';
const DATABASE_VERSION = 2;
const STORES = ['cachedPages', 'downloadedPages', 'downloadJobs', 'downloadStates', 'readingProgress', 'bookmarks'];

export function chapterStorageKey(chapter) {
  return [chapter?.sourceId, chapter?.workId, chapter?.id]
    .map(value => encodeURIComponent(String(value ?? '')))
    .join('::');
}

export function pageStorageKey(chapterKey, pageIndex) {
  return `${chapterKey}::${Number(pageIndex)}`;
}

function openDatabase(indexedDB) {
  if (!indexedDB?.open) return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of STORES) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error || new Error('Could not open Manga offline storage.'));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Manga offline storage is blocked by another open tab.'));
    };
  });
}

function runTransaction(database, storeNames, mode, operation) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = database.transaction(storeNames, mode);
    } catch (error) {
      reject(error);
      return;
    }

    const stores = Object.fromEntries(storeNames.map(name => [name, transaction.objectStore(name)]));
    let result;
    let resultWasSet = false;
    try {
      const request = operation(stores, value => {
        result = value;
        resultWasSet = true;
      });
      if (request && 'onsuccess' in request) {
        const previousSuccess = request.onsuccess;
        request.onsuccess = event => {
          if (typeof previousSuccess === 'function') previousSuccess.call(request, event);
          if (!resultWasSet) {
            result = request.result;
            resultWasSet = true;
          }
        };
      }
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
  });
}

export function createMangaStorage({ indexedDB = globalThis.indexedDB, storageManager = globalThis.navigator?.storage } = {}) {
  let databasePromise;
  const database = () => {
    if (databasePromise) return databasePromise;
    let opening;
    opening = openDatabase(indexedDB).then(db => {
      db.onversionchange = () => {
        db.close();
        if (databasePromise === opening) databasePromise = null;
      };
      return db;
    }).catch(error => {
      if (databasePromise === opening) databasePromise = null;
      throw error;
    });
    databasePromise = opening;
    return opening;
  };
  const read = async (store, key) => {
    const db = await database();
    return runTransaction(db, [store], 'readonly', stores => stores[store].get(key));
  };
  const put = async (store, record) => {
    const db = await database();
    await runTransaction(db, [store], 'readwrite', stores => stores[store].put(record));
  };

  return {
    async getCachedPage(chapterKey, pageIndex) {
      return (await read('cachedPages', pageStorageKey(chapterKey, pageIndex)))?.blob || null;
    },
    async putCachedPage(chapterKey, page, blob) {
      await put('cachedPages', { key: pageStorageKey(chapterKey, page.index), chapterKey, pageIndex: page.index, blob, savedAt: Date.now() });
    },
    async getDownloadedPage(chapterKey, pageIndex) {
      return (await read('downloadedPages', pageStorageKey(chapterKey, pageIndex)))?.blob || null;
    },
    async putDownloadedPage(chapterKey, page, blob) {
      await put('downloadedPages', { key: pageStorageKey(chapterKey, page.index), chapterKey, pageIndex: page.index, blob, savedAt: Date.now() });
    },
    async createDownloadIntent(chapterKey) {
      const db = await database();
      return runTransaction(db, ['downloadStates'], 'readwrite', (stores, setResult) => {
        const request = stores.downloadStates.get(chapterKey);
        request.onsuccess = () => {
          const state = request.result || { key: chapterKey, generation: 0, runId: null, intentCounter: 0 };
          const intent = { chapterKey, generation: state.generation, intentId: (state.intentCounter || 0) + 1 };
          stores.downloadStates.put({ ...state, intentCounter: intent.intentId });
          setResult(intent);
        };
        return request;
      });
    },
    async beginDownload(chapterKey, runId, intent) {
      const db = await database();
      return runTransaction(db, ['downloadStates'], 'readwrite', (stores, setResult) => {
        const request = stores.downloadStates.get(chapterKey);
        request.onsuccess = () => {
          const state = request.result || { key: chapterKey, generation: 0, runId: null, intentCounter: 0 };
          if (state.generation !== intent.generation) {
            setResult(null);
            return;
          }
          const generation = state.generation + 1;
          const token = { chapterKey, generation, runId };
          stores.downloadStates.put({ ...state, generation, runId });
          setResult(token);
        };
        return request;
      });
    },
    async putDownloadedPageIfCurrent(chapterKey, page, blob, token) {
      const db = await database();
      return runTransaction(db, ['downloadStates', 'downloadedPages'], 'readwrite', (stores, setResult) => {
        const request = stores.downloadStates.get(chapterKey);
        request.onsuccess = () => {
          const state = request.result;
          const current = state?.generation === token.generation && state?.runId === token.runId;
          if (current) {
            stores.downloadedPages.put({ key: pageStorageKey(chapterKey, page.index), chapterKey, pageIndex: page.index, blob, savedAt: Date.now() });
          }
          setResult(current);
        };
        return request;
      });
    },
    async getDownloadedPageIndexes(chapterKey) {
      const db = await database();
      const records = await runTransaction(db, ['downloadedPages'], 'readonly', stores => stores.downloadedPages.getAll());
      return records.filter(record => record.chapterKey === chapterKey).map(record => record.pageIndex).sort((a, b) => a - b);
    },
    async deleteDownloadedChapter(chapterKey) {
      const db = await database();
      await runTransaction(db, ['downloadedPages', 'downloadJobs', 'downloadStates'], 'readwrite', stores => {
        stores.downloadJobs.delete(chapterKey);
        const stateRequest = stores.downloadStates.get(chapterKey);
        stateRequest.onsuccess = () => {
          const generation = (stateRequest.result?.generation || 0) + 1;
          stores.downloadStates.put({ key: chapterKey, generation, runId: null, intentCounter: stateRequest.result?.intentCounter || 0 });
        };
        const request = stores.downloadedPages.getAll();
        request.onsuccess = () => {
          for (const record of request.result) {
            if (record.chapterKey === chapterKey) stores.downloadedPages.delete(record.key);
          }
        };
        return request;
      });
    },
    async clearTemporaryCache() {
      const db = await database();
      await runTransaction(db, ['cachedPages'], 'readwrite', stores => stores.cachedPages.clear());
    },
    async getDownloadJob(chapterKey) {
      return (await read('downloadJobs', chapterKey)) || null;
    },
    async putDownloadJob(job) {
      await put('downloadJobs', { ...job, key: job.chapterKey, updatedAt: Date.now() });
    },
    async putDownloadJobIfCurrent(job, token) {
      const db = await database();
      return runTransaction(db, ['downloadStates', 'downloadJobs'], 'readwrite', (stores, setResult) => {
        const request = stores.downloadStates.get(token.chapterKey);
        request.onsuccess = () => {
          const state = request.result;
          const current = state?.generation === token.generation && state?.runId === token.runId;
          if (current) stores.downloadJobs.put({ ...job, key: job.chapterKey, updatedAt: Date.now() });
          setResult(current);
        };
        return request;
      });
    },
    async releaseDownload(token) {
      const db = await database();
      return runTransaction(db, ['downloadStates'], 'readwrite', (stores, setResult) => {
        const request = stores.downloadStates.get(token.chapterKey);
        request.onsuccess = () => {
          const state = request.result;
          const current = state?.generation === token.generation && state?.runId === token.runId;
          if (current) stores.downloadStates.put({ ...state, runId: null });
          setResult(current);
        };
        return request;
      });
    },
    async listDownloadJobs() {
      const db = await database();
      const jobs = await runTransaction(db, ['downloadJobs'], 'readonly', stores => stores.downloadJobs.getAll());
      return jobs.sort((left, right) => right.updatedAt - left.updatedAt);
    },
    async getReadingProgress(chapterKey) {
      return (await read('readingProgress', chapterKey)) || null;
    },
    async putReadingProgress(chapterKey, progress) {
      await put('readingProgress', { ...progress, key: chapterKey, updatedAt: Date.now() });
    },
    async getBookmark(chapterKey) {
      return (await read('bookmarks', chapterKey)) || null;
    },
    async putBookmark(chapterKey, pageIndex) {
      await put('bookmarks', { key: chapterKey, pageIndex, updatedAt: Date.now() });
    },
    async deleteBookmark(chapterKey) {
      const db = await database();
      await runTransaction(db, ['bookmarks'], 'readwrite', stores => stores.bookmarks.delete(chapterKey));
    },
    async getStorageEstimate() {
      if (typeof storageManager?.estimate !== 'function') return { usage: null, quota: null };
      try {
        const { usage = null, quota = null } = await storageManager.estimate();
        return { usage, quota };
      } catch {
        return { usage: null, quota: null };
      }
    },
    async close() {
      const pending = databasePromise;
      databasePromise = null;
      if (pending) {
        try {
          (await pending).close();
        } catch {
          // The failed open was already reported to the operation that requested it.
        }
      }
    }
  };
}
