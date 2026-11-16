# SeasonFetch delivery checklist

## Interactive SeasonFetch preview
- [x] Recreate the supplied reference direction with a near-black background, lavender accents, rounded bordered panels, restrained typography, and a compact editorial utility layout.
- [x] Include a compact top navigation bar with SeasonFetch branding and utility controls.
- [x] Include a hero section with concise headline, supporting copy, and a responsive TV-series search form.
- [x] Make search interactive using realistic local sample data, including loading, error, no-results, and initial empty states.
- [x] Make search result cards selectable and clearly indicate the active selection.
- [x] Include selected-series details with poster artwork, metadata, synopsis, status, genres, and season information.
- [x] Include a season selector that updates the displayed episode list and progress summary.
- [x] Include a responsive episode source table with source availability, status, and relevant actions.
- [x] Make episode rows expandable to reveal source information without leaving the page.
- [x] Make copy-magnet actions functional with clear success feedback.
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
- [x] Select the smallest known 1080p source while retaining an unknown-size source only when no known size exists.
- [x] Show live Torrentio status in the UI and preserve clearly labeled preview fallback data when the provider is unavailable.

## Delivery checks
- [x] Verify the Vite Preview forwards API requests to the provider proxy.
- [x] Verify the real Torrentio proxy returns a normalized Breaking Bad source.
- [x] Verify live Cinemeta search and metadata loading for The Office, including real season options.
- [x] Verify parser tests and the production frontend build complete successfully.
- [ ] Configure production deployment routing for the Express server if publishing is requested.
