const SOURCE_ID = 'mock-catalog';

const works = [
  {
    id: 'work-quiet-orbit', sourceId: SOURCE_ID, title: 'The Quiet Orbit',
    alternateTitles: ['静かな軌道'],
    description: 'A cartographer maps forgotten stations at the edge of a drifting world, one small discovery at a time.',
    author: 'M. Aster', artist: 'Nami Vale', status: 'ongoing', year: 2024,
    genres: ['Adventure', 'Sci-fi', 'Slice of life'], coverColor: '#51447e',
    volumes: [
      { id: 'volume-orbit-1', workId: 'work-quiet-orbit', sourceId: SOURCE_ID, number: 1, title: 'The First Map', chapterIds: ['chapter-orbit-1', 'chapter-orbit-2'] },
      { id: 'volume-orbit-2', workId: 'work-quiet-orbit', sourceId: SOURCE_ID, number: 2, title: 'Farther Out', chapterIds: ['chapter-orbit-3', 'chapter-orbit-10'] }
    ]
  },
  {
    id: 'work-garden-after-rain', sourceId: SOURCE_ID, title: 'A Garden After Rain',
    alternateTitles: ['雨上がりの庭'],
    description: 'Two neighbors restore an overgrown courtyard and find a new rhythm in the changing seasons.',
    author: 'Ira Jun', status: 'completed', year: 2022,
    genres: ['Drama', 'Romance'], coverColor: '#536d60',
    volumes: [{ id: 'volume-garden-1', workId: 'work-garden-after-rain', sourceId: SOURCE_ID, number: 1, title: 'New Growth', chapterIds: ['chapter-garden-1', 'chapter-garden-2'] }]
  },
  {
    id: 'work-last-train', sourceId: SOURCE_ID, title: 'The Last Train at Dawn',
    alternateTitles: [],
    description: 'A night-shift conductor carries a handful of passengers toward a station that appears only before sunrise.',
    author: 'L. Rowan', status: 'hiatus', year: 2025,
    genres: ['Mystery', 'Fantasy'], coverColor: '#765142',
    volumes: [{ id: 'volume-train-1', workId: 'work-last-train', sourceId: SOURCE_ID, number: 1, title: 'Night Service', chapterIds: ['chapter-train-1', 'chapter-train-2'] }]
  }
];

const chapterRows = [
  ['chapter-orbit-10', 'work-quiet-orbit', 'volume-orbit-2', 2, 10, 'The Far Station', 4],
  ['chapter-orbit-2', 'work-quiet-orbit', 'volume-orbit-1', 1, 2, 'A Signal in the Dust', 3],
  ['chapter-orbit-1', 'work-quiet-orbit', 'volume-orbit-1', 1, 1, 'The Mapmaker', 4],
  ['chapter-orbit-3', 'work-quiet-orbit', 'volume-orbit-2', 2, 3, 'Night Navigation', 3],
  ['chapter-garden-2', 'work-garden-after-rain', 'volume-garden-1', 1, 2, 'The Open Gate', 3],
  ['chapter-garden-1', 'work-garden-after-rain', 'volume-garden-1', 1, 1, 'The Courtyard', 4],
  ['chapter-train-2', 'work-last-train', 'volume-train-1', 1, 2, 'Platform Seven', 3],
  ['chapter-train-1', 'work-last-train', 'volume-train-1', 1, 1, 'Before Sunrise', 4]
];

const chapters = chapterRows.map(([id, workId, volumeId, volumeNumber, number, title, pageCount]) => ({
  id,
  sourceId: SOURCE_ID,
  workId,
  volumeId,
  volumeNumber,
  number,
  title,
  language: 'en',
  readingSource: {
    id: `source-${workId}`,
    name: 'Local sample source',
    language: 'en',
    workId,
    chapterIds: chapterRows.filter(row => row[1] === workId).map(row => row[0])
  },
  pageCount,
  publishedAt: '2025-02-14'
}));

function makePageImage(page) {
  const width = 640;
  const height = 900;
  const pageLabel = String(page.index + 1).padStart(2, '0');
  const seed = page.index % 3;
  const color = ['#b99aff', '#82d4a3', '#e0b776'][seed];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="640" height="900" fill="#121318"/><rect x="34" y="34" width="572" height="832" rx="10" fill="#f2eee6"/><path d="M72 90h496v330H72z" fill="#d9d2c8"/><circle cx="320" cy="245" r="88" fill="${color}" opacity=".82"/><path d="M112 383c66-96 132-126 208-80 55-85 129-87 208 0v117H112z" fill="#292633"/><path d="M99 497h442v12H99zm0 35h410v8H99zm0 65h200v8H99zm0 38h365v8H99z" fill="#847f7a" opacity=".65"/><rect x="98" y="684" width="444" height="110" rx="5" fill="#e3ddd2"/><text x="320" y="748" fill="#2a2731" font-family="sans-serif" font-size="26" text-anchor="middle">SAMPLE PAGE ${pageLabel}</text><text x="320" y="824" fill="#77717c" font-family="sans-serif" font-size="15" text-anchor="middle">SEASONFETCH · MOCK READER</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

export function createMockMangaProvider({ failures = {} } = {}) {
  const remainingFailures = new Map(Object.entries(failures).map(([key, count]) => [key, Number(count) || 0]));

  return {
    sourceId: SOURCE_ID,
    async search(query = '') {
      const normalized = String(query).trim().toLocaleLowerCase();
      return works.filter(work => !normalized || [work.title, ...work.alternateTitles, ...work.genres].join(' ').toLocaleLowerCase().includes(normalized));
    },
    async getDetails(workId) {
      const work = works.find(item => item.id === workId);
      if (!work) throw new Error('This sample title is unavailable.');
      return structuredClone(work);
    },
    async getChapters(workId) {
      return chapters.filter(chapter => chapter.workId === workId).map(chapter => structuredClone(chapter));
    },
    async getPages(chapterId) {
      const chapter = chapters.find(item => item.id === chapterId);
      if (!chapter) throw new Error('This sample chapter is unavailable.');
      return Array.from({ length: chapter.pageCount }, (_, index) => ({
        id: `${chapter.id}:page:${index}`,
        sourceId: chapter.sourceId,
        chapterId: chapter.id,
        index,
        label: `Page ${index + 1}`,
        mimeType: 'image/svg+xml'
      })).reverse();
    },
    async getPageImage(page) {
      const failuresLeft = remainingFailures.get(page.id) || 0;
      if (failuresLeft > 0) {
        remainingFailures.set(page.id, failuresLeft - 1);
        throw new Error('One sample page request failed. Retry this page.');
      }
      return makePageImage(page);
    }
  };
}

export const mockCatalogSourceId = SOURCE_ID;
