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
- Expand episode rows to inspect the selected Torrentio source, provider, seeder count, file index, tracker count, and file-aware magnet URI.
- Open or copy Stremio local download links (`127.0.0.1:11470`) and magnet links, plus open provider URLs when Torrentio returns one.
- Live sources expose a tracker-enhanced magnet and a raw magnet fallback. Tracker values are encoded as `tr=udp%3A...` or `tr=http%3A...`; the info hash belongs only in `xt=urn:btih:...`.
- Copy all available live season magnets at once or download them as a newline-separated `.txt` file for batch importing into a compatible downloader. Preview fallback rows are excluded.
- Surface partial provider failures instead of presenting them as a successful scan.
- Responsive desktop and mobile layouts.

## Torrentio integration

The development command starts Vite on port 3000 and the Express provider proxy on port 3001. Vite forwards `/api` requests to the proxy. Search uses live Cinemeta, and selected series load their real season and episode metadata before scanning Torrentio. The proxy calls Torrentio with the Stremio series identifier format `tt...:season:episode`, limits season lookups to three concurrent requests, accepts valid 1080p sources only, preserves safe provider links and file indexes, and ranks results by 1337x preference, highest known seeder count, then smallest known file size. If either provider is unavailable, the UI keeps working with clearly labeled local demo data where possible.

Stremio download links use the local desktop server format `http://127.0.0.1:11470/<infoHash>/<fileIndex>?external=1&download=1`. They work only when Stremio Desktop is running with its local server available on the same computer as the browser; magnet links remain available as a fallback.

If a Stremio link reports `ERR_CONNECTION_REFUSED`, first open `http://127.0.0.1:11470/` in the same browser. If that also fails, start Stremio Desktop or install and start [Stremio Service](https://www.stremio.com/download-service). Stremio’s official guidance says the companion service must be installed and running for local streaming-server features, and the browser and service must be on the same computer. The expanded source panel also includes **Check Stremio** to test this connection.

Only live Torrentio results produce downloadable magnets. When Torrentio is unavailable, SeasonFetch may show clearly labeled preview rows, but it no longer exposes their placeholder hashes as magnets because those hashes cannot resolve metadata and would remain stuck on “querying info.”

Set `TORRENTIO_BASE_URL`, `CINEMETA_BASE_URL`, or `CLIENT_ORIGIN` to override production defaults. The proxy exposes `GET /api/health`, `GET /api/cinemeta/search?q=title`, `GET /api/cinemeta/series/:id`, and `GET /api/torrentio/season/:seriesId/:season?episodes=1,2,3`.
