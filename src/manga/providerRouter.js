import { createMangaDownloadManager } from './downloadManager.js';

export function createRequestGuard() {
  let latestId = 0;
  return {
    next() {
      latestId += 1;
      return latestId;
    },
    isCurrent(id) {
      return id === latestId;
    },
    invalidate() {
      latestId += 1;
    }
  };
}

export function createMangaProviderRouter(providersBySourceId, storage, managerOptions = {}) {
  const providerMap = new Map(Object.entries(providersBySourceId));
  const managerMap = new Map();

  for (const [sourceId, provider] of providerMap.entries()) {
    managerMap.set(sourceId, createMangaDownloadManager(provider, storage, managerOptions));
  }

  function getProvider(sourceId) {
    const provider = providerMap.get(sourceId);
    if (!provider) throw new Error(`Unknown manga provider: ${sourceId}`);
    return provider;
  }

  function getManager(sourceId) {
    const manager = managerMap.get(sourceId);
    if (!manager) throw new Error(`No download manager available for source: ${sourceId}`);
    return manager;
  }

  return {
    getProvider,
    hasProvider(sourceId) {
      return providerMap.has(sourceId);
    },
    download(chapter, options) {
      return getManager(chapter?.sourceId).download(chapter, options);
    },
    retry(chapter, options) {
      return getManager(chapter?.sourceId).retry(chapter, options);
    },
    async cancelAndWait(chapterKey, sourceId) {
      if (sourceId && managerMap.has(sourceId)) {
        await managerMap.get(sourceId).cancelAndWait(chapterKey);
        return;
      }
      await Promise.all([...managerMap.values()].map(manager => manager.cancelAndWait(chapterKey)));
    },
    async resumeInterrupted({ onUpdate = () => {} } = {}) {
      const batches = await Promise.all(
        [...managerMap.entries()].map(([sourceId, manager]) =>
          manager.resumeInterrupted({ sourceId, onUpdate })
        )
      );
      return batches.flat();
    }
  };
}
