const SOURCE_ID = 'mangadex';

async function requestJson(path, fetchImpl = fetch) {
  const response = await fetchImpl(path, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = response.headers?.get?.('retry-after');
    const error = new Error(data.error || `MangaDex request failed (${response.status}).`);
    error.status = response.status;
    if (retryAfter) error.retryAfter = retryAfter;
    throw error;
  }
  return data;
}

export function createMangaDexProvider({
  basePath = '/api/manga/mangadex',
  quality = 'data-saver',
  language = 'en',
  fetchImpl = (...args) => globalThis.fetch(...args)
} = {}) {
  const cleanBase = String(basePath || '/api/manga/mangadex').replace(/\/+$/, '');
  const chapterFeedMeta = new Map();

  return {
    sourceId: SOURCE_ID,
    async search(query = '') {
      const params = new URLSearchParams({ language });
      const cleanQuery = String(query || '').trim();
      if (cleanQuery) params.set('q', cleanQuery);
      const data = await requestJson(`${cleanBase}/search?${params.toString()}`, fetchImpl);
      return Array.isArray(data.results) ? data.results : [];
    },
    async getDetails(workId) {
      const data = await requestJson(`${cleanBase}/work/${encodeURIComponent(workId)}`, fetchImpl);
      if (!data.work) throw new Error('Manga details were not returned.');
      return data.work;
    },
    async getChapters(workId) {
      const params = new URLSearchParams({ language });
      const data = await requestJson(`${cleanBase}/work/${encodeURIComponent(workId)}/chapters?${params.toString()}`, fetchImpl);
      const chapters = Array.isArray(data.chapters) ? data.chapters : [];
      const total = Number.isFinite(Number(data.total)) ? Number(data.total) : chapters.length;
      chapterFeedMeta.set(workId, {
        loaded: chapters.length,
        total,
        truncated: Boolean(data.truncated) || total > chapters.length
      });
      return chapters;
    },
    getChapterFeedInfo(workId) {
      return chapterFeedMeta.get(workId) || null;
    },
    async getPages(chapterId) {
      const params = new URLSearchParams({ quality });
      const data = await requestJson(`${cleanBase}/chapter/${encodeURIComponent(chapterId)}/pages?${params.toString()}`, fetchImpl);
      return Array.isArray(data.pages) ? data.pages : [];
    },
    async getPageImage(page) {
      const targetUrl = page?.imageUrl
        || `${cleanBase}/page/${encodeURIComponent(page?.chapterId || '')}/${encodeURIComponent(quality)}/${page?.index ?? 0}`;
      const response = await fetchImpl(targetUrl, { headers: { Accept: 'image/*' } });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Page image could not be loaded (${response.status}).`);
      }
      const blob = await response.blob();
      if (!blob || blob.size === 0) throw new Error('Page image response was empty.');
      return blob;
    }
  };
}

export const mangadexSourceId = SOURCE_ID;
