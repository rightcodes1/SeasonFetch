# SeasonFetch

SeasonFetch is a polished interactive front-end for discovering TV episode sources. It recreates the supplied reference direction and connects to Torrentio through a server-side proxy that normalizes provider responses before they reach the UI.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The managed Preview uses the configured port 3000.

## Included interactions

- Search sample series such as Breaking Bad, The Bear, Severance, and Succession.
- Select a series and switch seasons.
- Run a source scan with loading feedback and realistic episode states.
- Expand episode rows to inspect the selected source and magnet URI.
- Copy magnet links with success feedback.
- Responsive desktop and mobile layouts.

## Torrentio integration

The development command starts Vite on port 3000 and the Express provider proxy on port 3001. Vite forwards `/api` requests to the proxy. Search now uses Cinemeta live, and selected series load their real season and episode metadata before scanning Torrentio. The proxy calls Torrentio with the Stremio series identifier format `tt...:season:episode`, limits season lookups to three concurrent requests, accepts valid 1080p sources only, and chooses the smallest known file size. If either provider is unavailable, the Preview keeps working with clearly labeled local demo data where possible.

Set `TORRENTIO_BASE_URL` or `CINEMETA_BASE_URL` to override the default provider base URLs. The proxy exposes `GET /api/health`, `GET /api/cinemeta/search?q=title`, `GET /api/cinemeta/series/:id`, and `GET /api/torrentio/season/:seriesId/:season?episodes=N`.
