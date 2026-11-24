import test from "node:test";
import assert from "node:assert/strict";
import app from "../app.js";
import {
  clearMangaDexCache,
  isAllowedAtHomeBaseUrl,
  MANGADEX_SOURCE_ID,
  MAX_MANGADEX_IMAGE_BYTES
} from "../services/mangadex.js";
import { createMangaDexProvider } from "../../src/manga/mangadexProvider.js";
import { createMangaProviderRouter, createRequestGuard } from "../../src/manga/providerRouter.js";
import { chapterStorageKey } from "../../src/manga/storage.js";

const WORK_ID = "11111111-2222-3333-4444-555555555555";
const CHAPTER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const EXT_CHAPTER_ID = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const RETRY_CHAPTER_ID = "cccccccc-dddd-eeee-ffff-000000000000";
const FAIL_CHAPTER_ID = "dddddddd-eeee-ffff-0000-111111111111";
const SAMPLE_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

async function withServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function mockUpstreamFetch(t, handler) {
  const originalFetch = global.fetch;
  global.fetch = (input, options) => {
    const url = new URL(input);
    if (url.hostname === "127.0.0.1") return originalFetch(input, options);
    return handler(input, options);
  };
  t.after(() => {
    global.fetch = originalFetch;
    clearMangaDexCache();
  });
}

function createMemoryStorage() {
  const jobs = new Map();
  const states = new Map();
  const pages = new Map();
  return {
    async createDownloadIntent(chapterKey) {
      const state = states.get(chapterKey) || { generation: 0, runId: null, intentCounter: 0 };
      const intent = { chapterKey, generation: state.generation, intentId: state.intentCounter + 1 };
      states.set(chapterKey, { ...state, intentCounter: intent.intentId });
      return intent;
    },
    async beginDownload(chapterKey, runId, intent) {
      const state = states.get(chapterKey) || { generation: 0, runId: null, intentCounter: 0 };
      if (state.generation !== intent.generation) return null;
      const generation = state.generation + 1;
      states.set(chapterKey, { ...state, generation, runId });
      return { chapterKey, generation, runId };
    },
    async putDownloadedPageIfCurrent(chapterKey, page, blob, token) {
      const state = states.get(chapterKey);
      if (state?.generation !== token.generation || state?.runId !== token.runId) return false;
      pages.set(`${chapterKey}::${page.index}`, { chapterKey, pageIndex: page.index, blob });
      return true;
    },
    async getDownloadedPageIndexes(chapterKey) {
      return [...pages.values()].filter(r => r.chapterKey === chapterKey).map(r => r.pageIndex).sort((a, b) => a - b);
    },
    async getDownloadJob(chapterKey) {
      return jobs.get(chapterKey) || null;
    },
    async putDownloadJobIfCurrent(job, token) {
      const state = states.get(token.chapterKey);
      if (state?.generation !== token.generation || state?.runId !== token.runId) return false;
      jobs.set(job.chapterKey, { ...job, updatedAt: Date.now() });
      return true;
    },
    async putDownloadJob(job) {
      jobs.set(job.chapterKey, { ...job, updatedAt: Date.now() });
    },
    async releaseDownload(token) {
      const state = states.get(token.chapterKey);
      if (state?.generation === token.generation && state?.runId === token.runId) {
        states.set(token.chapterKey, { ...state, runId: null });
      }
      return true;
    },
    async listDownloadJobs() {
      return [...jobs.values()];
    }
  };
}

test("MangaDex search normalizes English titles, cover proxy URLs, authors, redirect:error, and User-Agent", async t => {
  const captured = [];
  mockUpstreamFetch(t, async (input, options) => {
    captured.push({ url: String(input), headers: options?.headers, signal: options?.signal, redirect: options?.redirect });
    return Response.json({
      data: [
        {
          id: WORK_ID,
          attributes: {
            title: { "ko-ro": "Na Honjaman Level Up" },
            altTitles: [{ en: "Solo Leveling" }, { ja: "俺だけレベルアップな件" }],
            description: { en: "A hunter levels up alone." },
            status: "completed",
            year: 2018,
            tags: [
              { attributes: { group: "genre", name: { en: "Action" } } },
              { attributes: { group: "format", name: { en: "Long Strip" } } }
            ]
          },
          relationships: [
            { id: "a1", type: "author", attributes: { name: "Chugong" } },
            { id: "a2", type: "artist", attributes: { name: "DUBU" } },
            { id: "c1", type: "cover_art", attributes: { fileName: "cover-01.jpg" } }
          ]
        }
      ]
    });
  });

  const base = await withServer(t);
  const res = await fetch(`${base}/api/manga/mangadex/search?q=solo`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.provider, MANGADEX_SOURCE_ID);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].title, "Solo Leveling");
  assert.equal(body.results[0].author, "Chugong");
  assert.equal(body.results[0].artist, "DUBU");
  assert.deepEqual(body.results[0].genres, ["Action"]);
  assert.equal(body.results[0].coverUrl, `/api/manga/mangadex/cover/${WORK_ID}/cover-01.jpg`);
  assert.equal(captured[0].redirect, "error");
  assert.match(captured[0].headers["User-Agent"], /SeasonFetch/);
  assert.ok(captured[0].signal instanceof AbortSignal);
});

test("At-Home URL validation rejects credentials, query strings, fragments, non-root paths, and foreign hosts", () => {
  assert.equal(isAllowedAtHomeBaseUrl("https://cmdxd98sb0x3yprd.mangadex.network"), true);
  assert.equal(isAllowedAtHomeBaseUrl("https://uploads.mangadex.org"), true);
  assert.equal(isAllowedAtHomeBaseUrl("https://user:pass@node.mangadex.network"), false);
  assert.equal(isAllowedAtHomeBaseUrl("https://node.mangadex.network?redirect=http://169.254.169.254"), false);
  assert.equal(isAllowedAtHomeBaseUrl("https://node.mangadex.network#fragment"), false);
  assert.equal(isAllowedAtHomeBaseUrl("https://node.mangadex.network/nested/path"), false);
  assert.equal(isAllowedAtHomeBaseUrl("http://node.mangadex.network"), false);
  assert.equal(isAllowedAtHomeBaseUrl("https://evil-ssrf.example"), false);
});

test("MangaDex rejects upstream redirects on both JSON and image fetches", async t => {
  const seenOptions = [];
  mockUpstreamFetch(t, async (input, options) => {
    seenOptions.push({ url: String(input), redirect: options?.redirect });
    const url = new URL(input);
    if (url.pathname === "/manga") {
      return new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }
    if (url.pathname === `/at-home/server/${CHAPTER_ID}`) {
      return Response.json({
        baseUrl: "https://node.mangadex.network",
        chapter: { hash: "h1", data: ["1.jpg"], dataSaver: ["1.jpg"] }
      });
    }
    if (url.hostname === "node.mangadex.network") {
      return new Response("", { status: 302, headers: { location: "http://169.254.169.254/secret" } });
    }
    throw new Error(`Unexpected URL: ${input}`);
  });

  const base = await withServer(t);
  const searchRes = await fetch(`${base}/api/manga/mangadex/search?q=redirect`);
  assert.equal(searchRes.status, 502);
  assert.match((await searchRes.json()).error, /redirect/i);

  const pageRes = await fetch(`${base}/api/manga/mangadex/page/${CHAPTER_ID}/data-saver/0`);
  assert.equal(pageRes.status, 502);
  assert.match((await pageRes.json()).error, /redirect/i);

  assert.ok(seenOptions.every(item => item.redirect === "error"), "All upstream MangaDex fetches must pass redirect: 'error'");
});

test("MangaDex rejects SVG and unsupported image content types", async t => {
  mockUpstreamFetch(t, async input => {
    const url = new URL(input);
    if (url.pathname === `/at-home/server/${CHAPTER_ID}`) {
      return Response.json({
        baseUrl: "https://node.mangadex.network",
        chapter: { hash: "h1", data: ["1.svg", "2.html"], dataSaver: ["1.svg", "2.html"] }
      });
    }
    if (url.pathname.endsWith("1.svg")) {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', {
        status: 200,
        headers: { "content-type": "image/svg+xml" }
      });
    }
    if (url.pathname.endsWith("2.html")) {
      return new Response("<html>not an image</html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }
    throw new Error(`Unexpected URL: ${input}`);
  });

  const base = await withServer(t);
  const svgRes = await fetch(`${base}/api/manga/mangadex/page/${CHAPTER_ID}/data-saver/0`);
  assert.equal(svgRes.status, 502);
  assert.match((await svgRes.json()).error, /unsupported/i);

  const htmlRes = await fetch(`${base}/api/manga/mangadex/page/${CHAPTER_ID}/data-saver/1`);
  assert.equal(htmlRes.status, 502);
});

test("MangaDex rejects oversized images via Content-Length and via bounded streaming when Content-Length is missing or dishonest", async t => {
  mockUpstreamFetch(t, async input => {
    const url = new URL(input);
    if (url.pathname === `/at-home/server/${CHAPTER_ID}`) {
      return Response.json({
        baseUrl: "https://node.mangadex.network",
        chapter: { hash: "h1", data: ["header-big.jpg", "stream-big.jpg"], dataSaver: ["header-big.jpg", "stream-big.jpg"] }
      });
    }
    if (url.pathname.endsWith("header-big.jpg")) {
      return new Response(SAMPLE_PNG, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(MAX_MANGADEX_IMAGE_BYTES + 1024)
        }
      });
    }
    if (url.pathname.endsWith("stream-big.jpg")) {
      const chunk = new Uint8Array(1024 * 1024);
      let emitted = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (emitted >= 5) {
            controller.close();
            return;
          }
          emitted += 1;
          controller.enqueue(chunk);
        }
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": "1024"
        }
      });
    }
    throw new Error(`Unexpected URL: ${input}`);
  });

  const base = await withServer(t);
  const headerBig = await fetch(`${base}/api/manga/mangadex/page/${CHAPTER_ID}/data-saver/0`);
  assert.equal(headerBig.status, 502);
  assert.match((await headerBig.json()).error, /maximum allowed size/i);

  const streamBig = await fetch(`${base}/api/manga/mangadex/page/${CHAPTER_ID}/data-saver/1`);
  assert.equal(streamBig.status, 502);
  assert.match((await streamBig.json()).error, /maximum allowed size/i);
});

test("MangaDex preserves upstream 429 with Retry-After and maps TimeoutError to 504", async t => {
  mockUpstreamFetch(t, async input => {
    const url = new URL(input);
    if (url.searchParams.get("title") === "ratelimited") {
      return new Response(JSON.stringify({ errors: [{ detail: "Too Many Requests" }] }), {
        status: 429,
        headers: { "retry-after": "17" }
      });
    }
    if (url.searchParams.get("title") === "timeout") {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    throw new Error(`Unexpected URL: ${input}`);
  });

  const base = await withServer(t);
  const res429 = await fetch(`${base}/api/manga/mangadex/search?q=ratelimited`);
  assert.equal(res429.status, 429);
  assert.equal(res429.headers.get("retry-after"), "17");

  const res504 = await fetch(`${base}/api/manga/mangadex/search?q=timeout`);
  assert.equal(res504.status, 504);
});

test("Stale At-Home cache evicts and retries exactly once on node failure without retrying indefinitely", async t => {
  let retryAtHomeLookups = 0;
  let failAtHomeLookups = 0;
  let failNodeAttempts = 0;

  mockUpstreamFetch(t, async input => {
    const url = new URL(input);
    if (url.pathname === `/at-home/server/${RETRY_CHAPTER_ID}`) {
      retryAtHomeLookups += 1;
      return Response.json({
        baseUrl: retryAtHomeLookups === 1 ? "https://stale-node.mangadex.network" : "https://fresh-node.mangadex.network",
        chapter: { hash: `h${retryAtHomeLookups}`, data: ["1.jpg"], dataSaver: ["1.jpg"] }
      });
    }
    if (url.hostname === "stale-node.mangadex.network") {
      return new Response("gone", { status: 410 });
    }
    if (url.hostname === "fresh-node.mangadex.network") {
      return new Response(SAMPLE_PNG, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url.pathname === `/at-home/server/${FAIL_CHAPTER_ID}`) {
      failAtHomeLookups += 1;
      return Response.json({
        baseUrl: `https://broken-${failAtHomeLookups}.mangadex.network`,
        chapter: { hash: `b${failAtHomeLookups}`, data: ["1.jpg"], dataSaver: ["1.jpg"] }
      });
    }
    if (url.hostname.startsWith("broken-")) {
      failNodeAttempts += 1;
      return new Response("upstream down", { status: 503 });
    }
    throw new Error(`Unexpected URL: ${input}`);
  });

  const base = await withServer(t);
  // Populate cache via /pages first, then stale node fails -> refreshes once -> succeeds.
  const pagesRes = await fetch(`${base}/api/manga/mangadex/chapter/${RETRY_CHAPTER_ID}/pages`);
  assert.equal(pagesRes.status, 200);
  const recoveredRes = await fetch(`${base}/api/manga/mangadex/page/${RETRY_CHAPTER_ID}/data-saver/0`);
  assert.equal(recoveredRes.status, 200);
  assert.deepEqual(Buffer.from(await recoveredRes.arrayBuffer()), SAMPLE_PNG);
  assert.equal(retryAtHomeLookups, 2, "Expected initial lookup + 1 fresh refresh");

  // Populate cache for permanently failing node -> retries at most once (2 node attempts, 2 at-home lookups).
  await fetch(`${base}/api/manga/mangadex/chapter/${FAIL_CHAPTER_ID}/pages`);
  const failedRes = await fetch(`${base}/api/manga/mangadex/page/${FAIL_CHAPTER_ID}/data-saver/0`);
  assert.equal(failedRes.status, 502);
  assert.equal(failAtHomeLookups, 2, "Must refresh At-Home at most once");
  assert.equal(failNodeAttempts, 2, "Must attempt page fetch at most twice (cached + 1 retry)");
});

test("Chapter feed paginates multiple pages, reports truncation accurately, and strips javascript: externalUrls", async t => {
  const offsets = [];
  let totalChapters = 250;
  mockUpstreamFetch(t, async input => {
    const url = new URL(input);
    if (url.pathname === `/manga/${WORK_ID}/feed`) {
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || 100);
      offsets.push({ offset, limit });
      const count = Math.min(limit, Math.max(0, totalChapters - offset));
      const batch = Array.from({ length: count }, (_, idx) => {
        const n = offset + idx + 1;
        return {
          id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
          attributes: {
            volume: "1",
            chapter: String(n),
            title: `Episode ${n}`,
            translatedLanguage: "en",
            pages: n === 2 ? 0 : 10,
            externalUrl: n === 2 ? "javascript:alert(1)" : n === 3 ? "https://mangaplus.shueisha.co.jp/viewer/3" : null
          },
          relationships: [{ id: "g1", type: "scanlation_group", attributes: { name: "Group A" } }]
        };
      });
      return Response.json({ total: totalChapters, data: batch });
    }
    throw new Error(`Unexpected URL: ${input}`);
  });

  const base = await withServer(t);
  const res = await fetch(`${base}/api/manga/mangadex/work/${WORK_ID}/chapters?limit=150`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(offsets, [{ offset: 0, limit: 100 }, { offset: 100, limit: 50 }]);
  assert.equal(body.chapters.length, 150);
  assert.equal(body.total, 250);
  assert.equal(body.truncated, true);
  assert.equal(body.chapters[1].externalUrl, null, "javascript: externalUrl must be stripped");
  assert.equal(body.chapters[1].readableInline, false);
  assert.equal(body.chapters[2].externalUrl, "https://mangaplus.shueisha.co.jp/viewer/3");
  assert.equal(body.chapters[2].readableInline, false);

  // Verify frontend provider surfaces feed truncation metadata without changing getChapters() return type.
  const provider = createMangaDexProvider({
    basePath: `${base}/api/manga/mangadex`,
    fetchImpl: (path, init) => global.fetch(path.startsWith("http") ? path : `${base}${path}`, init)
  });
  const list = await provider.getChapters(WORK_ID);
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 250);
  const info = provider.getChapterFeedInfo(WORK_ID);
  assert.equal(info.total, 250);
  assert.equal(info.loaded, 250);
  assert.equal(info.truncated, false);

  // Verify truncation metadata when total exceeds the 300-chapter default cap.
  totalChapters = 350;
  const truncatedList = await provider.getChapters(WORK_ID);
  assert.equal(truncatedList.length, 300);
  const truncatedInfo = provider.getChapterFeedInfo(WORK_ID);
  assert.equal(truncatedInfo.total, 350);
  assert.equal(truncatedInfo.loaded, 300);
  assert.equal(truncatedInfo.truncated, true);
});

test("MangaDex cover proxy blocks invalid filenames and falls back from .256.jpg to original", async t => {
  mockUpstreamFetch(t, async input => {
    const url = new URL(input);
    if (url.pathname.endsWith("cover-01.jpg.256.jpg")) return new Response("missing", { status: 404 });
    if (url.pathname.endsWith("cover-01.jpg")) {
      return new Response(SAMPLE_PNG, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    throw new Error(`Unexpected upstream URL: ${input}`);
  });

  const base = await withServer(t);
  const badCover = await fetch(`${base}/api/manga/mangadex/cover/${WORK_ID}/..secret.jpg`);
  assert.equal(badCover.status, 400);

  const okCover = await fetch(`${base}/api/manga/mangadex/cover/${WORK_ID}/cover-01.jpg`);
  assert.equal(okCover.status, 200);
  assert.deepEqual(Buffer.from(await okCover.arrayBuffer()), SAMPLE_PNG);
});

test("Cross-provider router isolates resume, retry, and cancellation by job sourceId", async () => {
  const storage = createMemoryStorage();
  const mangadexCalls = [];
  const sampleCalls = [];
  let releaseSamplePage;
  const sampleStarted = new Promise(resolve => { releaseSamplePage = resolve; });
  let continueSamplePage;
  const samplePageGate = new Promise(resolve => { continueSamplePage = resolve; });

  const mangadexProvider = {
    sourceId: "mangadex",
    async getPages(chapterId) {
      mangadexCalls.push(`pages:${chapterId}`);
      return [{ id: `${chapterId}:page:0`, sourceId: "mangadex", chapterId, index: 0 }];
    },
    async getPageImage(page) {
      mangadexCalls.push(`img:${page.id}`);
      return new Blob([SAMPLE_PNG], { type: "image/png" });
    }
  };
  const sampleProvider = {
    sourceId: "mock-catalog",
    async getPages(chapterId) {
      sampleCalls.push(`pages:${chapterId}`);
      return [
        { id: `${chapterId}:page:0`, sourceId: "mock-catalog", chapterId, index: 0 },
        { id: `${chapterId}:page:1`, sourceId: "mock-catalog", chapterId, index: 1 }
      ];
    },
    async getPageImage(page) {
      sampleCalls.push(`img:${page.id}`);
      if (page.chapterId === "chapter-live-cancel" && page.index === 0) {
        releaseSamplePage();
        await samplePageGate;
      }
      return new Blob(["<svg/>"], { type: "image/svg+xml" });
    }
  };

  const router = createMangaProviderRouter({
    mangadex: mangadexProvider,
    "mock-catalog": sampleProvider
  }, storage);

  // Seed one interrupted mock-catalog job and one interrupted mangadex job.
  const mockChapter = { id: "chapter-orbit-1", sourceId: "mock-catalog", workId: "work-1", title: "Sample Ch 1", number: 1 };
  const mdChapter = { id: CHAPTER_ID, sourceId: "mangadex", workId: WORK_ID, title: "MD Ch 1", number: 1 };
  await storage.putDownloadJob({ chapterKey: chapterStorageKey(mockChapter), sourceId: "mock-catalog", workId: "work-1", chapterId: "chapter-orbit-1", chapterTitle: "Sample Ch 1", chapterNumber: 1, status: "paused", completedPages: [], failedPages: [], totalPages: 2 });
  await storage.putDownloadJob({ chapterKey: chapterStorageKey(mdChapter), sourceId: "mangadex", workId: WORK_ID, chapterId: CHAPTER_ID, chapterTitle: "MD Ch 1", chapterNumber: 1, status: "paused", completedPages: [], failedPages: [], totalPages: 1 });

  const resumed = await router.resumeInterrupted();
  assert.equal(resumed.length, 2);
  assert.ok(resumed.every(job => job.status === "complete"));
  assert.deepEqual(mangadexCalls, [`pages:${CHAPTER_ID}`, `img:${CHAPTER_ID}:page:0`]);
  assert.deepEqual(sampleCalls, ["pages:chapter-orbit-1", "img:chapter-orbit-1:page:0", "img:chapter-orbit-1:page:1"]);

  // Verify cancellation still reaches an active mock-catalog download regardless of active UI tab.
  const cancelChapter = { id: "chapter-live-cancel", sourceId: "mock-catalog", workId: "work-1", title: "Cancel Test", number: 2 };
  const downloadPromise = router.download(cancelChapter);
  await sampleStarted;
  const cancelPromise = router.cancelAndWait(chapterStorageKey(cancelChapter), "mock-catalog");
  continueSamplePage();
  const [downloadResult] = await Promise.all([downloadPromise, cancelPromise]);
  assert.equal(downloadResult.status, "paused");
  assert.equal(sampleCalls.includes("img:chapter-live-cancel:page:1"), false, "Cancelled loop must not fetch subsequent pages");
});

test("createRequestGuard rejects stale search and details responses when newer requests start", () => {
  const guard = createRequestGuard();
  const first = guard.next();
  assert.equal(guard.isCurrent(first), true);
  const second = guard.next();
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(second), false);
});
