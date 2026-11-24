# Manga provider recommendation: The Greatest Estate Developer

**Assessment date: 2026-11-24.** The official English WEBTOON listing confirms that *The Greatest Estate Developer* is available there and marks the series completed. WEBTOON's terms say its digital content is owned or licensed to WEBTOON; the user license is limited to personal, non-commercial use. Official app downloads are limited to one device and up to 30 days, and the terms prohibit unauthorized scraping and copying. WEBTOON's help page also says not every episode is downloadable. These terms do not authorize SeasonFetch to collect page images or provide its own offline copies. Treat WEBTOON as the canonical discovery/deep-link destination only unless WEBTOON provides written permission and a suitable documented API.

MangaDex's public API recognizes the title, but its English chapter aggregate currently returns only chapters 207, 210, and 223.9. That is not enough coverage for a complete chapter-ordering and offline-reading acceptance test. API availability alone does not establish rights to reproduce the chapters. MangaDex's API documentation also requires a truthful User-Agent, says clients must proxy its services because it does not provide cross-site CORS and blocks image hotlinking, and documents a global limit of approximately five API requests per second per IP. This makes a compliant adapter technically possible in principle, but not a sufficiently complete or rights-cleared provider for the requested acceptance title.

## Recommendation

No provider is presently verified as both sufficiently complete and authorized for SeasonFetch to fetch and retain this title's chapter images. Use WEBTOON only as an external official link. Do not scrape WEBTOON, copy its app's downloads, or use MangaDex page content for the acceptance test without documented permission for the specific content and intended online/offline use. Revisit the provider choice if WEBTOON or another rights-holder supplies written authorization and documented API access, or if a provider with a clearly licensed catalog and offline-use rights is identified.

## Adapter and contract plan

The existing provider-neutral interface already has the core operations: `search(query)`, `getDetails(workId)`, `getChapters(workId)`, `getPages(chapterId)`, and `getPageImage(page)`. An authorized adapter can map title, language, source, volume/chapter number, stable page order, and page-image `Blob` data to those methods. Before integrating a real provider, extend the contracts to carry a canonical external title/chapter URL, explicit provider capabilities for online reading and offline retention, applicable region/expiry constraints, and pagination/cursor information where the source catalog is paged. Keep rights/capability checks separate from ordinary image fetching so a mock or metadata-only source cannot accidentally be treated as offline-downloadable.

## Minimal implementation sequence

1. Obtain and record written authorization, API documentation, permitted territories, and online/offline retention rules for the intended title.
2. Add fixture-based adapter tests for title search, metadata, language/source identity, chapter pagination, decimal/special chapter ordering, and unavailable chapters; first verify actual title coverage through the permitted API.
3. Implement only the authorized metadata adapter and deep links. Add pagination and rate limiting if required by the provider.
4. Add page listing and `Blob` delivery only when explicitly permitted. Exercise the existing download manager, retry/resume, IndexedDB deletion fence, offline reader, bookmarks, and progress against provider fixtures and a permitted test account/content set.
5. Run browser acceptance checks for search, ordered chapters, one chapter download, interrupted-download recovery, offline reading, bookmark/progress restore, and deletion without affecting another chapter.

No provider code, scraping, or live chapter downloads were performed for this assessment.

## References

[1]: https://m.webtoons.com/en/fantasy/the-greatest-estate-developer/list?title_no=3596 "WEBTOON official English title listing"
[2]: https://www.webtoons.com/en/terms "WEBTOON Service Terms of Use"
[3]: https://webtoon.zendesk.com/hc/en-us/articles/360051600511-How-do-I-download-WEBTOON-episodes "WEBTOON official download help"
[4]: https://api.mangadex.org/manga/d7f56ace-cd30-48b9-8b64-afeca0077fca "MangaDex title metadata API"
[5]: https://api.mangadex.org/manga/d7f56ace-cd30-48b9-8b64-afeca0077fca/aggregate?translatedLanguage%5B%5D=en "MangaDex English chapter aggregate API"
[6]: https://api.mangadex.org/docs/2-limitations/ "MangaDex API limitations and requirements"
