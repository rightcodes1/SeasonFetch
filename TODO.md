# SeasonFetch delivery checklist

## Interactive SeasonFetch preview
- [x] Recreate the supplied reference direction with a near-black background, lavender accents, rounded bordered panels, restrained typography, and a compact editorial utility layout.
- [x] Include a compact top navigation bar with SeasonFetch branding and utility controls.
- [x] Include a hero section with concise headline, supporting copy, and a responsive TV-series search form.
- [x] Make search interactive using realistic local sample data, including loading, error, no-results, and initial empty states.
- [x] Make search result cards selectable and clearly indicate the active selection.
- [x] Include selected-series details with poster artwork, metadata, synopsis, status, genres, and season information.
- [x] Render real Cinemeta poster thumbnails and enriched ratings in search result cards, with visible fallbacks when optional metadata is missing.
- [x] Include a season selector that updates the displayed episode list and progress summary.
- [x] Include a responsive episode source table with source availability, status, and relevant actions.
- [x] Make episode rows expandable to reveal source information without leaving the page.
- [x] Make open-magnet, provider-link, and copy-magnet actions functional with clear success feedback.
- [x] Include a responsive mobile layouts for the compact viewport.

## Live Cinemeta metadata
- [x] Search arbitrary TV titles through the server-side Cinemeta proxy instead of limiting search to local demo titles.
- [x] Load selected-series metadata, real season counts, and normalized episode metadata from Cinemeta.
- [x] Preserve a clearly labeled local preview catalog fallback when Cinemeta is unavailable.

## Live Torrentio provider
- [x] Add a server-side Express proxy for Torrentio rather than calling the provider directly from the browser.
- [x] Use the `tt...:season:episode` Stremio series identifier format and validate IMDb IDs, seasons, and episode counts.
- [x] Limit season lookups to three concurrent provider requests.
- [x] Normalize Torrentio responses to valid 40-character info hashes, explicit 1080p sources, normalized file sizes, file indexes, and magnet links.
- [x] Select valid 1080p sources by preferring 1337x, then highest known seeder count, then smallest known file size, while retaining an unknown-size source only when no known size exists.
- [x] Preserve safe Torrentio source URLs, file indexes, tracker counts, and file-aware magnet links.
- [x] Query the actual Cinemeta episode numbers, including sparse or non-contiguous seasons, instead of assuming 1..N.
- [x] Surface partial and complete Torrentio provider failures distinctly from normal no-source results.
- [x] Show live Torrentio status in the UI and preserve clearly labeled preview fallback data when the provider is unavailable.

## Production deployment
- [x] Export the Express app for a Vercel Node function while retaining the local server entrypoint.
- [x] Add Vercel build and API rewrite configuration for the Vite frontend and provider proxy.
- [x] Verify the production deployment serves `/`, `/api/health`, Cinemeta search, and Torrentio source scans.

## Delivery checks
- [x] Verify the Vite Preview forwards API requests to the provider proxy.
- [x] Verify the real Torrentio proxy returns a normalized Breaking Bad source.
- [x] Verify live Cinemeta search and metadata loading for The Office, including real season options.
- [x] Verify parser tests and the production frontend build complete successfully after the provider and deployment changes.
- [x] Smoke-test the production Express entrypoint, `/api/health`, live Cinemeta search, and a live Torrentio episode scan locally.
