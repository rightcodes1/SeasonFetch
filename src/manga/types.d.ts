export interface Volume {
  id: string;
  workId: string;
  sourceId: string;
  number: number | null;
  title?: string;
  chapterIds: string[];
}

export interface MangaWork {
  id: string;
  sourceId: string;
  title: string;
  alternateTitles: string[];
  description: string;
  author?: string;
  artist?: string;
  status?: 'ongoing' | 'completed' | 'hiatus' | 'unknown';
  genres: string[];
  year?: number;
  coverColor?: string;
  volumes?: Volume[];
}

export interface ReadingSource {
  id: string;
  name: string;
  language: string;
  workId: string;
  chapterIds: string[];
}

export interface Chapter {
  id: string;
  sourceId: string;
  workId: string;
  volumeId?: string;
  volumeNumber?: number | null;
  number: number | null;
  title: string;
  language: string;
  readingSource: ReadingSource;
  pageCount: number;
  publishedAt?: string;
}

export interface Page {
  id: string;
  sourceId: string;
  chapterId: string;
  index: number;
  label?: string;
  mimeType?: string;
}

export interface MangaProvider {
  search(query: string): Promise<MangaWork[]>;
  getDetails(workId: string): Promise<MangaWork>;
  getChapters(workId: string): Promise<Chapter[]>;
  getPages(chapterId: string): Promise<Page[]>;
  getPageImage(page: Page): Promise<Blob>;
}

export interface MangaStorage {
  getCachedPage(chapterKey: string, pageIndex: number): Promise<Blob | null>;
  putCachedPage(chapterKey: string, page: Page, image: Blob): Promise<void>;
  getDownloadedPage(chapterKey: string, pageIndex: number): Promise<Blob | null>;
  putDownloadedPage(chapterKey: string, page: Page, image: Blob): Promise<void>;
  getDownloadedPageIndexes(chapterKey: string): Promise<number[]>;
  deleteDownloadedChapter(chapterKey: string): Promise<void>;
  clearTemporaryCache(): Promise<void>;
  getDownloadJob(chapterKey: string): Promise<Record<string, unknown> | null>;
  putDownloadJob(job: Record<string, unknown>): Promise<void>;
  listDownloadJobs(): Promise<Array<Record<string, unknown>>>;
  getReadingProgress(chapterKey: string): Promise<Record<string, unknown> | null>;
  putReadingProgress(chapterKey: string, progress: Record<string, unknown>): Promise<void>;
  getBookmark(chapterKey: string): Promise<Record<string, unknown> | null>;
  putBookmark(chapterKey: string, pageIndex: number): Promise<void>;
  deleteBookmark(chapterKey: string): Promise<void>;
  getStorageEstimate(): Promise<{ usage: number | null; quota: number | null }>;
  close(): Promise<void>;
}
