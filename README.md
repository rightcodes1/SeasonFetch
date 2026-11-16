# SeasonFetch

SeasonFetch is a polished interactive front-end for discovering TV episode sources. It recreates the supplied reference direction and connects to Cinemeta and Torrentio through a server-side proxy that normalizes provider responses before they reach the UI.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The managed Preview uses the configured port 3000.

For production, run `npm ci && npm run build && npm start`. Vercel uses `vercel.json`, the `api/index.js` Express entrypoint, and the same build command to serve the Vite frontend and provider API together.

## Included interactions

- Search arbitrary series through live Cinemeta metadata, with local sample data as an explicitly labeled fallback.
- Render Cinemeta poster thumbnails and enriched ratings in search results when the provider supplies them.
- Select a series and switch seasons.
- Run a source scan using the actual episode numbers returned by Cinemeta.
- Expand episode rows to inspect the selected Torrentio source, file index, tracker count, and file-aware magnet URI.
- Open or copy magnet links, plus open provider URLs when Torrentio returns one.
- Surface partial provider failures instead of presenting them as a successful scan.
- Responsive desktop and mobile layouts.

## Torrentio integration

The development command starts Vite on port 3000 and the Express provider proxy on port 3001. Vite forwards `/api` requests to the proxy. Search uses live Cinemeta, and selected series load their real season and episode metadata before scanning Torrentio. The proxy calls Torrentio with the Stremio series identifier format `tt...:season:episode`, limits season lookups to three concurrent requests, accepts valid 1080p sources only, preserves safe provider links and file indexes, and chooses the smallest known file size. If either provider is unavailable, the UI keeps working with clearly labeled local demo data where possible.

Set `TORRENTIO_BASE_URL`, `CINEMETA_BASE_URL`, or `CLIENT_ORIGIN` to override production defaults. The proxy exposes `GET /api/health`, `GET /api/cinemeta/search?q=title`, `GET /api/cinemeta/series/:id`, and `GET /api/torrentio/season/:seriesId/:season?episodes=1,2,3`.
